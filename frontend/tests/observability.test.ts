import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  }
  let apiFailureObserver:
    | ((
        error: unknown,
        context: { method: string; path: string; requestId?: string | null; status?: number },
      ) => void)
    | null = null

  return {
    active: vi.fn(() => ({})),
    apiFailureObserver: () => apiFailureObserver,
    fetchInstrumentation: vi.fn(),
    inject: vi.fn(),
    providerCtor: vi.fn(),
    register: vi.fn(),
    resourceFromAttributes: vi.fn(),
    registerInstrumentations: vi.fn(),
    setApiFailureObserver: vi.fn((observer) => {
      apiFailureObserver = observer
    }),
    setLogger: vi.fn(),
    span,
    spanProcessor: vi.fn(),
    startActiveSpan: vi.fn(),
    traceExporter: vi.fn(),
  }
})

vi.mock('@opentelemetry/api', () => ({
  context: { active: mocks.active },
  diag: { setLogger: mocks.setLogger },
  DiagConsoleLogger: class {},
  DiagLogLevel: { WARN: 2 },
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mocks.startActiveSpan,
    }),
  },
}))

vi.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: class {
    inject(
      activeContext: unknown,
      carrier: Record<string, string>,
      setter: { set: (headers: Record<string, string>, key: string, value: string) => void },
    ) {
      mocks.inject(activeContext, carrier, setter)
    }
  },
}))

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(config: unknown) {
      mocks.traceExporter(config)
    }
  },
}))

vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: mocks.registerInstrumentations,
}))

vi.mock('@opentelemetry/instrumentation-fetch', () => ({
  FetchInstrumentation: class {
    constructor(config: unknown) {
      mocks.fetchInstrumentation(config)
    }
  },
}))

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attributes: unknown) => {
    mocks.resourceFromAttributes(attributes)
    return { attributes }
  },
}))

vi.mock('@opentelemetry/sdk-trace-web', () => ({
  BatchSpanProcessor: class {
    constructor(exporter: unknown) {
      mocks.spanProcessor(exporter)
    }
  },
  WebTracerProvider: class {
    register = mocks.register

    constructor(config: unknown) {
      mocks.providerCtor(config)
    }
  },
}))

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME: 'deployment.environment.name',
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}))

vi.mock('../src/api', () => ({
  getToken: () => 'test-token',
  SESSION_ID: 'test-session-id',
  setApiFailureObserver: mocks.setApiFailureObserver,
}))

const runtimeWindow = window as typeof window & {
  __HRIV_RUNTIME_CONFIG__?: { otelEndpointBase64?: string }
}

describe('observability', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.stubGlobal('performance', { getEntriesByType: vi.fn(() => []) })
    window.history.replaceState({}, '', '/')
    delete runtimeWindow.__HRIV_RUNTIME_CONFIG__
    mocks.startActiveSpan.mockImplementation(
      (_name: string, callback: (span: typeof mocks.span) => unknown) => callback(mocks.span),
    )
    mocks.inject.mockImplementation(
      (
        _activeContext: unknown,
        carrier: Record<string, string>,
        setter: { set: (headers: Record<string, string>, key: string, value: string) => void },
      ) => setter.set(carrier, 'traceparent', '00-test-trace-test-span-01'),
    )
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the deployment-provided OTLP endpoint', async () => {
    runtimeWindow.__HRIV_RUNTIME_CONFIG__ = {
      otelEndpointBase64: btoa('https://telemetry.example.test/'),
    }
    const { initObservability } = await import('../src/observability')

    initObservability()

    expect(mocks.traceExporter).toHaveBeenCalledWith({
      url: 'https://telemetry.example.test/v1/traces',
    })
  })

  it('trims whitespace around the deployment-provided OTLP endpoint', async () => {
    runtimeWindow.__HRIV_RUNTIME_CONFIG__ = {
      otelEndpointBase64: btoa('  https://telemetry.example.test/  '),
    }
    const { initObservability } = await import('../src/observability')

    initObservability()

    expect(mocks.traceExporter).toHaveBeenCalledWith({
      url: 'https://telemetry.example.test/v1/traces',
    })
  })

  it('initializes once and flushes pending events on pagehide', async () => {
    window.history.replaceState({}, '', '/?synthetic=1')
    const { emitEvent, initObservability } = await import('../src/observability')

    initObservability()
    initObservability()
    emitEvent({ event: 'navigation.page_changed', page: 'browse' })
    // One batching flush timer plus the session-heartbeat interval.
    expect(vi.getTimerCount()).toBe(2)
    window.dispatchEvent(new Event('pagehide'))

    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.traceExporter).toHaveBeenCalledOnce()
    expect(mocks.providerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ spanProcessors: expect.any(Array) }),
    )
    expect(mocks.registerInstrumentations).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/api/telemetry/events',
      expect.objectContaining({ keepalive: true }),
    )
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'navigation.page_changed',
      event_version: 1,
      outcome: 'unknown',
      page: 'browse',
      synthetic: true,
      schema_version: 2,
    })
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('emits final performance metrics only once across repeated pagehide events', async () => {
    const observerCallbacks: Array<(entryList: { getEntries(): PerformanceEntry[] }) => void> = []
    class MockPerformanceObserver {
      static supportedEntryTypes = ['layout-shift']

      constructor(callback: (entryList: { getEntries(): PerformanceEntry[] }) => void) {
        observerCallbacks.push(callback)
      }

      observe(): void {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)
    vi.stubGlobal('performance', { getEntriesByType: vi.fn(() => []) })
    const { initObservability } = await import('../src/observability')

    initObservability()
    observerCallbacks[0]?.({
      getEntries: () =>
        [
          { value: 0.125, hadRecentInput: false, startTime: 0 } as PerformanceEntry,
        ] as PerformanceEntry[],
    })

    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'frontend.performance',
      action: 'cls',
      value: 0.125,
      unit: 'score',
    })
  })

  it('batches events and applies explicit synthetic mode', async () => {
    const { emitEvent, setSyntheticMode } = await import('../src/observability')

    setSyntheticMode(true)
    emitEvent({ event: 'image.view.ready', outcome: 'success', image_id: 5 })
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'image.view.ready',
      event_version: 1,
      outcome: 'success',
      synthetic: true,
      schema_version: 2,
      image_id: 5,
    })
  })

  it('sanitizes diagnostic messages', async () => {
    const { MAX_ERROR_MESSAGE_LENGTH, sanitizeDiagnosticMessage } =
      await import('../src/observability')

    expect(
      sanitizeDiagnosticMessage(
        'HTTP 404 attempting to load TileSource: https://hriv.example/api/tiles/abc.dzi?tile_token=secret\nextra',
      ),
    ).toBe('HTTP 404 attempting to load TileSource: [url] extra')
    expect(sanitizeDiagnosticMessage('Failed at /api/tiles/x.dzi')).toBe('Failed at [url]')
    expect(sanitizeDiagnosticMessage('Failed at ./cache/x.dzi')).toBe('Failed at [url]')
    expect(sanitizeDiagnosticMessage('Failed at ../cache/x.dzi')).toBe('Failed at [url]')
    expect(sanitizeDiagnosticMessage('Request key=value failed')).toBe('Request [url] failed')
    expect(sanitizeDiagnosticMessage('line\n\tbreak')).toBe('line break')

    const capped = sanitizeDiagnosticMessage('x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1))
    expect(capped).toBe(`${'x'.repeat(MAX_ERROR_MESSAGE_LENGTH - 1)}…`)
    expect(capped).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)

    expect(sanitizeDiagnosticMessage(42)).toBeUndefined()
    expect(sanitizeDiagnosticMessage(null)).toBeUndefined()
    expect(sanitizeDiagnosticMessage('')).toBeUndefined()
    expect(sanitizeDiagnosticMessage(' \n\t ')).toBeUndefined()
    expect(sanitizeDiagnosticMessage('Malformed DZI descriptor')).toBe('Malformed DZI descriptor')
  })

  it('sends sanitized frontend error messages without changing deduplication', async () => {
    const { emitFrontendError } = await import('../src/observability')

    emitFrontendError({
      action: 'image_viewer_open',
      error: 'image_viewer',
      errorCode: 'image_viewer_open_failed',
      message: 'Unable to load TileSource: https://hriv.example/tiles/x.dzi?token=secret',
      imageId: 7,
    })
    emitFrontendError({
      action: 'image_viewer_open',
      error: 'image_viewer',
      errorCode: 'image_viewer_open_failed',
      message: 'A different message',
      imageId: 7,
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'frontend.error',
      error_message: 'Unable to load TileSource: [url]',
    })
  })

  it('omits diagnostic messages that are empty after sanitization', async () => {
    const { emitEvent } = await import('../src/observability')

    emitEvent({ event: 'image.view.failed', error_message: ' \n\t ' })
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events[0]).not.toHaveProperty('error_message')
  })

  it('emits a session-start event only once per tab session', async () => {
    const { emitSessionStartedOnce } = await import('../src/observability')

    emitSessionStartedOnce('browse')
    emitSessionStartedOnce('browse')
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'application.session_started',
      event_version: 1,
      outcome: 'success',
      page: 'browse',
      schema_version: 2,
    })
  })

  it('falls back to an in-memory guard when sessionStorage is unavailable', async () => {
    const getItemSpy = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItemSpy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { emitSessionStartedOnce } = await import('../src/observability')

    emitSessionStartedOnce('browse')
    emitSessionStartedOnce('manage')
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'application.session_started',
      page: 'browse',
    })

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('reports user-visible API failures as sanitized frontend errors', async () => {
    const { initObservability } = await import('../src/observability')

    initObservability()
    const observer = mocks.apiFailureObserver()
    expect(observer).toBeTypeOf('function')

    observer?.(new Error('nope'), {
      method: 'GET',
      path: '/images/123',
      requestId: 'req-123',
      status: 503,
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events[0]).toMatchObject({
      event: 'frontend.error',
      event_version: 1,
      outcome: 'failure',
      action: 'request',
      error: 'api_http_5xx',
      error_code: 'api_http_5xx',
      request_id: 'req-123',
      schema_version: 2,
    })
  })

  it('injects the active trace context into headers', async () => {
    const { getTraceHeaders } = await import('../src/observability')

    expect(getTraceHeaders()).toEqual({
      traceparent: '00-test-trace-test-span-01',
    })
  })

  it('marks successful spans as OK and ends them', async () => {
    const { withSpan } = await import('../src/observability')

    await expect(withSpan('image.open', async () => 'done')).resolves.toBe('done')
    expect(mocks.span.setStatus).toHaveBeenCalledWith({ code: 1 })
    expect(mocks.span.end).toHaveBeenCalledOnce()
  })

  it('records and rethrows span errors', async () => {
    const error = new Error('failed')
    const { withSpan } = await import('../src/observability')

    await expect(
      withSpan('image.open', async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(mocks.span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'failed' })
    expect(mocks.span.recordException).toHaveBeenCalledWith(error)
    expect(mocks.span.end).toHaveBeenCalledOnce()
  })

  it('does nothing outside a browser environment', async () => {
    vi.stubGlobal('window', undefined)
    const { emitEvent, initObservability } = await import('../src/observability')

    expect(() => initObservability()).not.toThrow()
    expect(() => emitEvent({ event: 'navigation.page_changed' })).not.toThrow()
    expect(mocks.traceExporter).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('emits a session heartbeat while the tab is visible and authenticated', async () => {
    const { initObservability } = await import('../src/observability')

    initObservability()
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_100)

    expect(fetch).toHaveBeenCalledOnce()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      event: 'application.session_heartbeat',
      action: 'heartbeat',
      outcome: 'success',
    })
  })

  it('reports the guide page in session heartbeats', async () => {
    window.history.replaceState({}, '', '/?page=guide&doc=images')
    const { initObservability } = await import('../src/observability')

    initObservability()
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_100)

    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events[0]).toMatchObject({
      event: 'application.session_heartbeat',
      page: 'guide',
    })
  })

  it('reports the effective page override instead of a gated URL page', async () => {
    // A student deep-linked to ?page=guide renders browse; telemetry must agree.
    window.history.replaceState({}, '', '/?page=guide&doc=images')
    const { initObservability, setTelemetryPage } = await import('../src/observability')

    initObservability()
    setTelemetryPage('browse')
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_100)

    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const parsed = JSON.parse(String(request?.body))
    expect(parsed.events[0]).toMatchObject({
      event: 'application.session_heartbeat',
      page: 'browse',
    })
  })

  it('stops the session heartbeat on pagehide', async () => {
    const { initObservability } = await import('../src/observability')

    initObservability()
    window.dispatchEvent(new Event('pagehide'))
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('exports the implemented frontend telemetry event contract', async () => {
    const { TELEMETRY_EVENT_NAMES, TELEMETRY_SCHEMA_VERSION } = await import('../src/observability')

    expect(TELEMETRY_SCHEMA_VERSION).toBe(2)
    expect(TELEMETRY_EVENT_NAMES).toEqual([
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
      'reorder.operation',
      'ui.toolbar_action',
    ])
  })
})
