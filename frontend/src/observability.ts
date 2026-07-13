import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  type Span,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { Resource } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

import { SESSION_ID } from './api'

const DEFAULT_OTEL_ENDPOINT_PROD = 'https://telemetry.ltc.bcit.ca'
const DEFAULT_OTEL_ENDPOINT_DEV = 'http://localhost:4318'

let _loggerProvider: LoggerProvider | null = null
let _tracerProvider: WebTracerProvider | null = null
let _initialized = false
let _synthetic = false

function defaultEndpoint(): string {
  const mode = import.meta.env.MODE ?? 'development'
  return mode === 'production' ? DEFAULT_OTEL_ENDPOINT_PROD : DEFAULT_OTEL_ENDPOINT_DEV
}

function endpoint(): string {
  return import.meta.env.VITE_OTEL_ENDPOINT?.replace(/\/$/, '') ?? defaultEndpoint()
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
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

  _loggerProvider = new LoggerProvider({ resource })
  const logExporter = new OTLPLogExporter({
    url: `${endpoint()}/v1/logs`,
    headers: {},
  })
  _loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter))

  _tracerProvider = new WebTracerProvider({ resource })
  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint()}/v1/traces`,
  })
  _tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter))
  _tracerProvider.register({
    propagator: new W3CTraceContextPropagator(),
  })

  const fetchConfig: { clearTimingResources: boolean; propagateTraceHeaderCorsUrls?: RegExp[] } = {
    clearTimingResources: true,
  }
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    fetchConfig.propagateTraceHeaderCorsUrls = [new RegExp('^' + escapeRegExp(apiUrl))]
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
  /** Optional boolean flag identifying synthetic-monitor events. */
  synthetic?: boolean
  /** Other low-cardinality attributes explicitly allowed by the schema. */
  [key: string]: unknown
}

/**
 * Emit a structured usage/operational event as an OTLP log record.
 *
 * Events are sent to the public OpenTelemetry collector and forwarded to
 * Loki. The backend is the authoritative source for identity: this function
 * only includes the session ID and any active trace context. Do not pass
 * user IDs, email addresses, free-text search terms, or image filenames here.
 */
export function emitEvent(event: TelemetryEvent): void {
  if (!_loggerProvider) return

  const logger = _loggerProvider.getLogger('hriv-frontend', '1.0.0')
  const activeSpan = trace.getActiveSpan()
  const traceId = activeSpan?.spanContext().traceId
  const spanId = activeSpan?.spanContext().spanId

  const isError = event.outcome === 'failure'
  const attributes: Record<string, string | number | boolean> = {
    'event.name': event.event,
    'event.outcome': event.outcome ?? 'unknown',
    'browser.tab.session_id': SESSION_ID,
  }

  if (traceId) attributes['trace.id'] = traceId
  if (spanId) attributes['trace.span_id'] = spanId
  if (event.action) attributes['event.action'] = event.action
  if (event.duration_ms !== undefined) attributes['event.duration_ms'] = event.duration_ms
  if (_synthetic || event.synthetic) attributes['event.synthetic'] = true
  if (isError && event.error) attributes['error.type'] = event.error

  logger.emit({
    severityNumber: isError ? 17 : 9, // ERROR : INFO
    severityText: isError ? 'ERROR' : 'INFO',
    body: JSON.stringify(event),
    attributes,
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
