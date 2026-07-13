import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  type Span,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { Resource } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

import { getToken, SESSION_ID } from './api'

const DEFAULT_OTEL_TRACE_ENDPOINT_PROD = 'https://telemetry.ltc.bcit.ca'
const DEFAULT_OTEL_TRACE_ENDPOINT_DEV = 'http://localhost:4318'

let _tracerProvider: WebTracerProvider | null = null
let _initialized = false
let _synthetic = false
let _flushTimer: ReturnType<typeof setTimeout> | null = null
const _pendingEvents: TelemetryEvent[] = []

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
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

/**
 * Initialize the frontend OpenTelemetry SDK.
 *
 * Call this once near application startup. It is safe to call multiple
 * times; subsequent calls are no-ops. In non-browser environments (tests,
 * SSR) the SDK is not started.
 */
export function initObservability(): void {
  if (_initialized || !isBrowser()) return
  _initialized = true

  // Activate synthetic markers when the URL contains ?synthetic=1. This lets
  // Playwright journeys self-identify in Loki without a separate identity
  // system and without leaking real-user session data into the marker.
  try {
    if (new URLSearchParams(window.location.search).has('synthetic')) {
      _synthetic = true
    }
    ;(window as unknown as Record<string, unknown>).__HRIV_SESSION_ID__ = SESSION_ID
  } catch {
    // Defensive: malformed URLs should not prevent SDK startup.
  }

  // Surface SDK warnings only. The exporter is configured to swallow export
  // failures so telemetry problems never break the UI.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

  const env = import.meta.env.MODE ?? 'development'
  const serviceVersion = import.meta.env.VITE_APP_VERSION ?? 'dev'

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: 'hriv-frontend',
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env,
    'browser.tab.session_id': SESSION_ID,
  })

  _tracerProvider = new WebTracerProvider({ resource })
  const traceExporter = new OTLPTraceExporter({
    url: `${traceEndpoint()}/v1/traces`,
  })
  _tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter))
  _tracerProvider.register({
    propagator: new W3CTraceContextPropagator(),
  })

  const fetchConfig: { clearTimingResources: boolean; propagateTraceHeaderCorsUrls?: RegExp[] } = {
    clearTimingResources: true,
  }
  const baseUrl = apiUrl()
  if (baseUrl) {
    fetchConfig.propagateTraceHeaderCorsUrls = [new RegExp('^' + escapeRegExp(baseUrl))]
  }

  registerInstrumentations({
    instrumentations: [new FetchInstrumentation(fetchConfig)],
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface TelemetryEvent {
  /** Stable, dotted event name (e.g. image.view.ready). */
  event: string
  /** Outcome of the operation. */
  outcome?: 'success' | 'failure' | 'unknown'
  /** Duration in milliseconds when meaningful. */
  duration_ms?: number
  /** High-level error category; never include PII or free text payloads. */
  error?: string
  /** Low-cardinality action being performed (e.g. login, navigate, view). */
  action?: string
  /** Low-cardinality page identifier for navigation events. */
  page?: string
  /** Optional boolean flag identifying synthetic-monitor events. */
  synthetic?: boolean
}

function _flushEvents(): void {
  _flushTimer = null
  if (_pendingEvents.length === 0) return

  const events = _pendingEvents.splice(0, _pendingEvents.length)
  const base = apiUrl()
  // In production, VITE_API_URL points at the backend. In local development
  // Vite proxies the same-origin /api path to the backend, so a relative URL
  // works without requiring VITE_API_URL to be set.
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

/**
 * Emit a structured usage/operational event.
 *
 * Events are batched and sent to an authenticated backend ingestion endpoint
 * so the backend can validate the schema, enforce auth, and forward the event
 * to the collector. The backend is the authoritative source for identity: do
 * not pass user IDs, email addresses, free-text search terms, or image filenames
 * here.
 */
export function emitEvent(event: TelemetryEvent): void {
  if (!isBrowser()) return

  const normalized: TelemetryEvent = {
    ...event,
    outcome: event.outcome ?? 'unknown',
    synthetic: _synthetic || event.synthetic || false,
  }

  _pendingEvents.push(normalized)

  if (!_flushTimer) {
    _flushTimer = setTimeout(() => _flushEvents(), 1000)
  }
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
    set: (h: Record<string, string>, key: string, value: string) => {
      h[key] = value
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
      span.setStatus({ code: 1 }) // OK
      return result
    } catch (err) {
      span.setStatus({ code: 2, message: err instanceof Error ? err.message : String(err) }) // ERROR
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}
