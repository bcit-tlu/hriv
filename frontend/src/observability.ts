import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

import { getToken, SESSION_ID, setApiFailureObserver, type ApiFailureContext } from './api'
import { detectClientEnv, type ClientEnv } from './clientEnv'

/**
 * Version of the frontend telemetry payload. Bump this when the top-level
 * event shape changes so backend parsing can branch safely.
 */
export const TELEMETRY_SCHEMA_VERSION = 2

/**
 * Event names currently accepted by the authenticated backend ingestion
 * endpoint. Keep this in lockstep with `backend/app/routers/telemetry.py`.
 */
export const TELEMETRY_EVENT_NAMES = [
  'annotation.created',
  'annotation.deleted',
  'application.session_heartbeat',
  'application.session_started',
  'auth.login_succeeded',
  'auth.logout_selected',
  'category.created',
  'feedback.report_issue_opened',
  'feedback.report_issue_submitted',
  'frontend.error',
  'frontend.performance',
  'image.share_selected',
  'image.upload.completed',
  'image.view.started',
  'image.view.ready',
  'image.view.ended',
  'image.view.failed',
  'navigation.page_changed',
  'ui.toolbar_action',
] as const

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number]
const TELEMETRY_EVENT_VERSION = 1
const DEFAULT_OTEL_TRACE_ENDPOINT_PROD = 'https://telemetry.ltc.bcit.ca'
const DEFAULT_OTEL_TRACE_ENDPOINT_DEV = 'http://localhost:4318'
const SESSION_STARTED_STORAGE_KEY = `hriv.telemetry.${SESSION_ID}.session_started`
const ERROR_DEDUPE_TTL_MS = 30_000
const SESSION_HEARTBEAT_INTERVAL_MS = 5 * 60_000

export type TelemetryOutcome = 'success' | 'failure' | 'unknown'
export type TelemetryUnit = 'ms' | 'score'
export type TelemetryUploadMode = 'single' | 'bulk'
/** Bounded upload file types; keep in lockstep with the backend allowlist. */
export type TelemetryFileType =
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'tif'
  | 'tiff'
  | 'svs'
  | 'zip'
  | 'mixed'
  | 'other'
export type TelemetryErrorCode =
  | 'api_http_4xx'
  | 'api_http_5xx'
  | 'api_network_error'
  | 'image_viewer_init_failed'
  | 'image_viewer_open_failed'
  | 'react_render_error'
  | 'unhandled_promise_rejection'
  | 'window_runtime_error'
export type FrontendPerformanceMetric = 'application_load' | 'lcp' | 'inp' | 'cls' | 'image_ready'
export type FrontendPage = 'browse' | 'manage' | 'people' | 'admin' | 'unknown'

interface TelemetryEventBase {
  event: TelemetryEventName
  event_version?: 1
  outcome?: TelemetryOutcome
  duration_ms?: number
  error?: string
  error_code?: TelemetryErrorCode
  action?: string
  page?: FrontendPage
  from_page?: FrontendPage
  synthetic?: boolean
  image_id?: number
  category_id?: number
  from_category_id?: number
  request_id?: string
  trace_id?: string
  value?: number
  unit?: TelemetryUnit
  upload_mode?: TelemetryUploadMode
  file_type?: TelemetryFileType
}

export type TelemetryEvent = TelemetryEventBase
type TelemetryPayload = TelemetryEvent & Partial<ClientEnv> & { schema_version: number }

export interface FrontendErrorEventOptions {
  action: string
  error: string
  errorCode: TelemetryErrorCode
  page?: FrontendPage
  imageId?: number
  categoryId?: number
  requestId?: string | null
  dedupeKey?: string
}

export interface FrontendPerformanceEventOptions {
  metric: FrontendPerformanceMetric
  value: number
  unit: TelemetryUnit
  page?: FrontendPage
  imageId?: number
  categoryId?: number
}

let _tracerProvider: WebTracerProvider | null = null
let _initialized = false
let _synthetic = false
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _clientEnv: ClientEnv | null | undefined
let _appLoadMetricSent = false
let _finalPerformanceMetricsSent = false
let _pagehideHandlerAttached = false
let _windowErrorHandlerAttached = false
let _promiseRejectionHandlerAttached = false
let _sessionStartedEmitted = false
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null
let _latestLcpMs: number | null = null
let _largestInpMs: number | null = null
let _clsScore = 0
const _pendingEvents: TelemetryPayload[] = []
const _errorDedupe = new Map<string, number>()

function defaultTraceEndpoint(): string {
  const mode = import.meta.env.MODE ?? 'development'
  return mode === 'production' ? DEFAULT_OTEL_TRACE_ENDPOINT_PROD : DEFAULT_OTEL_TRACE_ENDPOINT_DEV
}

function traceEndpoint(): string {
  return import.meta.env.VITE_OTEL_ENDPOINT?.replace(/\/$/, '') ?? defaultTraceEndpoint()
}

function apiUrl(): string {
  return import.meta.env.VITE_API_URL ?? ''
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'X-Session-ID': SESSION_ID }
  const token = getToken()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function currentPage(): FrontendPage {
  if (!isBrowser()) return 'unknown'
  const page = new URLSearchParams(window.location.search).get('page')
  if (page === 'browse' || page === 'manage' || page === 'people' || page === 'admin') {
    return page
  }
  return 'browse'
}

function activeTraceId(): string | undefined {
  const getActiveSpan = (
    trace as {
      getActiveSpan?: () => { spanContext(): { traceId: string } } | undefined
    }
  ).getActiveSpan
  const span = getActiveSpan?.()
  const traceId = span?.spanContext().traceId
  return traceId && !/^0+$/.test(traceId) ? traceId : undefined
}

function roundMetric(value: number, unit: TelemetryUnit): number {
  if (!Number.isFinite(value)) return value
  if (unit === 'score') {
    return Math.round(value * 10_000) / 10_000
  }
  return Math.round(value)
}

function normalizeRequestId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function pruneErrorDedupe(now: number): void {
  for (const [key, seenAt] of _errorDedupe.entries()) {
    if (now - seenAt > ERROR_DEDUPE_TTL_MS) {
      _errorDedupe.delete(key)
    }
  }
}

function shouldEmitDedupedError(key: string): boolean {
  const now = Date.now()
  pruneErrorDedupe(now)
  const seenAt = _errorDedupe.get(key)
  if (seenAt && now - seenAt < ERROR_DEDUPE_TTL_MS) {
    return false
  }
  _errorDedupe.set(key, now)
  return true
}

function postEvents(events: TelemetryPayload[]): void {
  if (events.length === 0) return

  const base = apiUrl()
  const url = base ? `${base}/api/telemetry/events` : '/api/telemetry/events'

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).catch(() => {
    // Telemetry delivery is best-effort; never block the UI.
  })
}

function flushPendingEvents(): void {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer)
  }
  _flushTimer = null
  if (_pendingEvents.length === 0) return
  const events = _pendingEvents.splice(0, _pendingEvents.length)
  postEvents(events)
}

function queueFlush(): void {
  if (_flushTimer !== null) return
  _flushTimer = setTimeout(() => {
    flushPendingEvents()
  }, 1000)
}

function ensureClientEnv(): Partial<ClientEnv> {
  if (_clientEnv === undefined) {
    _clientEnv = detectClientEnv()
  }
  return _clientEnv ?? {}
}

function normalizeEvent(event: TelemetryEvent): TelemetryPayload {
  return {
    ...ensureClientEnv(),
    ...event,
    schema_version: TELEMETRY_SCHEMA_VERSION,
    event_version: event.event_version ?? TELEMETRY_EVENT_VERSION,
    outcome: event.outcome ?? 'unknown',
    synthetic: _synthetic || event.synthetic || false,
    trace_id: event.trace_id ?? activeTraceId(),
  }
}

function supportsPerformanceEntry(entryType: string): boolean {
  if (typeof PerformanceObserver === 'undefined') return false
  return (
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(entryType)
  )
}

function emitApplicationLoadMetric(): void {
  if (!isBrowser() || _appLoadMetricSent || typeof performance === 'undefined') return
  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  const loadEnd = navigationEntry?.loadEventEnd ?? 0
  if (!loadEnd) return
  _appLoadMetricSent = true
  emitFrontendPerformance({
    metric: 'application_load',
    value: loadEnd,
    unit: 'ms',
  })
}

function registerApplicationLoadMetric(): void {
  if (!isBrowser()) return
  if (document.readyState === 'complete') {
    emitApplicationLoadMetric()
    return
  }
  window.addEventListener('load', () => emitApplicationLoadMetric(), { once: true })
}

function registerPerformanceObservers(): void {
  if (!isBrowser() || typeof PerformanceObserver === 'undefined') return

  if (supportsPerformanceEntry('largest-contentful-paint')) {
    const lcpObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        _latestLcpMs = Math.max(_latestLcpMs ?? 0, entry.startTime)
      }
    })
    try {
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      // Some browsers expose the entry type but still reject observe options.
    }
  }

  if (supportsPerformanceEntry('layout-shift')) {
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as Array<
        PerformanceEntry & { value?: number; hadRecentInput?: boolean }
      >) {
        if (entry.hadRecentInput) continue
        _clsScore += entry.value ?? 0
      }
    })
    try {
      clsObserver.observe({ type: 'layout-shift', buffered: true })
    } catch {
      // Some browsers expose the entry type but still reject observe options.
    }
  }

  if (supportsPerformanceEntry('event')) {
    const inpObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as Array<
        PerformanceEntry & { duration?: number; interactionId?: number }
      >) {
        if (!entry.interactionId || !entry.duration) continue
        _largestInpMs = Math.max(_largestInpMs ?? 0, entry.duration)
      }
    })
    try {
      inpObserver.observe({
        type: 'event',
        buffered: true,
        ...(supportsPerformanceEntry('event')
          ? ({ durationThreshold: 16 } as { durationThreshold: number })
          : {}),
      } as PerformanceObserverInit)
    } catch {
      // Browsers that do not fully support Event Timing should degrade quietly.
    }
  }
}

function emitFinalPerformanceMetrics(): void {
  if (_finalPerformanceMetricsSent) return
  _finalPerformanceMetricsSent = true
  emitApplicationLoadMetric()
  if (_latestLcpMs !== null) {
    emitFrontendPerformance({ metric: 'lcp', value: _latestLcpMs, unit: 'ms' })
  }
  if (_largestInpMs !== null) {
    emitFrontendPerformance({ metric: 'inp', value: _largestInpMs, unit: 'ms' })
  }
  if (_clsScore > 0) {
    emitFrontendPerformance({ metric: 'cls', value: _clsScore, unit: 'score' })
  }
}

function handlePagehide(): void {
  stopHeartbeatInterval()
  emitFinalPerformanceMetrics()
  flushPendingEvents()
}

function registerWindowErrorHandlers(): void {
  if (!isBrowser()) return

  if (!_windowErrorHandlerAttached) {
    window.addEventListener('error', () => {
      emitFrontendError({
        action: 'window',
        error: 'runtime',
        errorCode: 'window_runtime_error',
      })
    })
    _windowErrorHandlerAttached = true
  }

  if (!_promiseRejectionHandlerAttached) {
    window.addEventListener('unhandledrejection', () => {
      emitFrontendError({
        action: 'promise',
        error: 'runtime',
        errorCode: 'unhandled_promise_rejection',
      })
    })
    _promiseRejectionHandlerAttached = true
  }
}

function startHeartbeatInterval(): void {
  if (_heartbeatTimer !== null) return
  _heartbeatTimer = setInterval(() => {
    // Only report time the user is plausibly active: an authenticated,
    // visible tab. Session length per role is derived from these beats.
    if (document.visibilityState !== 'visible') return
    if (!getToken()) return
    emitEvent({
      event: 'application.session_heartbeat',
      action: 'heartbeat',
      outcome: 'success',
      page: currentPage(),
    })
  }, SESSION_HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeatInterval(): void {
  if (_heartbeatTimer === null) return
  clearInterval(_heartbeatTimer)
  _heartbeatTimer = null
}

function registerSessionHeartbeat(): void {
  if (!isBrowser()) return
  startHeartbeatInterval()
  // Restart the heartbeat when the page is restored from the bfcache
  // (handlePagehide stops it so unloaded pages hold no live timers).
  window.addEventListener('pageshow', startHeartbeatInterval)
}

function registerApiFailureObserver(): void {
  setApiFailureObserver((error: unknown, failure: ApiFailureContext) => {
    const status =
      failure.status ??
      (error instanceof Error && 'status' in error ? Number(error.status) : undefined)
    const errorCode: TelemetryErrorCode =
      status === undefined ? 'api_network_error' : status >= 500 ? 'api_http_5xx' : 'api_http_4xx'
    const errorType = status === undefined ? 'network' : status >= 500 ? 'http_5xx' : 'http_4xx'
    emitFrontendError({
      action: 'request',
      error: `api_${errorType}`,
      errorCode,
      requestId: failure.requestId,
      dedupeKey: `api:${errorCode}:${failure.method}:${failure.path}:${status ?? 'network'}:${failure.requestId ?? 'none'}`,
    })
  })
}

/**
 * Initialize the frontend OpenTelemetry SDK and event instrumentation.
 *
 * Call this once near application startup. It is safe to call multiple times;
 * subsequent calls are no-ops. In non-browser environments (tests, SSR) the
 * SDK is not started.
 */
export function initObservability(): void {
  if (_initialized || !isBrowser()) return
  _initialized = true

  try {
    if (new URLSearchParams(window.location.search).has('synthetic')) {
      _synthetic = true
    }
    ;(window as unknown as Record<string, unknown>).__HRIV_SESSION_ID__ = SESSION_ID
  } catch {
    // Defensive: malformed URLs should not prevent SDK startup.
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

  const env = import.meta.env.MODE ?? 'development'
  const serviceVersion = import.meta.env.VITE_APP_VERSION ?? 'dev'
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'hriv-frontend',
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env,
    'browser.tab.session_id': SESSION_ID,
  })

  const traceExporter = new OTLPTraceExporter({
    url: `${traceEndpoint()}/v1/traces`,
  })
  _tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  })
  _tracerProvider.register({
    propagator: new W3CTraceContextPropagator(),
  })

  const fetchConfig: { clearTimingResources: boolean; propagateTraceHeaderCorsUrls?: RegExp[] } = {
    clearTimingResources: true,
  }
  const baseUrl = apiUrl()
  if (baseUrl) {
    fetchConfig.propagateTraceHeaderCorsUrls = [new RegExp(`^${escapeRegExp(baseUrl)}`)]
  }

  registerInstrumentations({
    instrumentations: [new FetchInstrumentation(fetchConfig)],
  })

  registerApplicationLoadMetric()
  registerPerformanceObservers()
  registerWindowErrorHandlers()
  registerApiFailureObserver()
  registerSessionHeartbeat()

  if (!_pagehideHandlerAttached) {
    window.addEventListener('pagehide', handlePagehide)
    _pagehideHandlerAttached = true
  }
}

/**
 * Emit a structured usage/operational event.
 *
 * Events are batched and sent to an authenticated backend ingestion endpoint
 * so the backend can validate the schema, enforce auth, and forward the event
 * to the collector. The backend is the authoritative source for identity: do
 * not pass user IDs, email addresses, free-text search terms, or image
 * filenames here.
 */
export function emitEvent(event: TelemetryEvent): void {
  if (!isBrowser()) return
  _pendingEvents.push(normalizeEvent(event))
  queueFlush()
}

export function emitEventNow(event: TelemetryEvent): void {
  emitEvent(event)
  flushPendingEvents()
}

export function emitSessionStartedOnce(page: FrontendPage = currentPage()): void {
  if (!isBrowser()) return
  if (_sessionStartedEmitted) return
  try {
    if (window.sessionStorage.getItem(SESSION_STARTED_STORAGE_KEY) === '1') {
      _sessionStartedEmitted = true
      return
    }
    window.sessionStorage.setItem(SESSION_STARTED_STORAGE_KEY, '1')
  } catch {
    // If sessionStorage is unavailable, the in-memory guard still prevents duplicates.
  }
  _sessionStartedEmitted = true
  emitEvent({
    event: 'application.session_started',
    action: 'session_start',
    outcome: 'success',
    page,
  })
}

export function emitFrontendError(options: FrontendErrorEventOptions): void {
  if (!isBrowser()) return
  const page = options.page ?? currentPage()
  const requestId = normalizeRequestId(options.requestId)
  const dedupeKey =
    options.dedupeKey ??
    `${options.errorCode}:${options.action}:${page}:${options.imageId ?? 'none'}:${options.categoryId ?? 'none'}:${requestId ?? 'none'}`
  if (!shouldEmitDedupedError(dedupeKey)) {
    return
  }
  emitEvent({
    event: 'frontend.error',
    action: options.action,
    error: options.error,
    error_code: options.errorCode,
    outcome: 'failure',
    page,
    image_id: options.imageId,
    category_id: options.categoryId,
    request_id: requestId,
  })
}

export function emitFrontendPerformance(options: FrontendPerformanceEventOptions): void {
  emitEvent({
    event: 'frontend.performance',
    action: options.metric,
    outcome: 'success',
    page: options.page ?? currentPage(),
    image_id: options.imageId,
    category_id: options.categoryId,
    value: roundMetric(options.value, options.unit),
    unit: options.unit,
  })
}

/**
 * Return a stable object of trace-context headers for outbound requests.
 *
 * The FetchInstrumentation already propagates traceparent for same-origin API
 * calls; this helper can be used for non-fetch transports or when the
 * automatic propagation is disabled.
 */
export function getTraceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const propagator = new W3CTraceContextPropagator()
  propagator.inject(context.active(), headers, {
    set: (carrier: Record<string, string>, key: string, value: string) => {
      carrier[key] = value
    },
  })
  return headers
}

/**
 * Mark telemetry from the current tab as synthetic. Used by automated
 * Playwright journeys so logs/traces can be filtered separately from real
 * users while still correlating via the shared session-id model.
 */
export function setSyntheticMode(enabled: boolean): void {
  _synthetic = enabled
}

/**
 * Wrap a promise/operation in a named span. Useful for explicit frontend
 * operations such as "open image" or "login".
 */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('hriv-frontend')
  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      const result = await fn()
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}
