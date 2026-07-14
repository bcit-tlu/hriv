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

describe('observability', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    window.history.replaceState({}, '', '/')
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

  it('initializes once and flushes pending events on pagehide', async () => {
    window.history.replaceState({}, '', '/?synthetic=1')
    const { emitEvent, initObservability } = await import('../src/observability')

    initObservability()
    initObservability()
    emitEvent({ event: 'navigation.page_changed', page: 'browse' })
    expect(vi.getTimerCount()).toBe(1)
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

  it('exports the implemented frontend telemetry event contract', async () => {
    const { TELEMETRY_EVENT_NAMES, TELEMETRY_SCHEMA_VERSION } = await import('../src/observability')

    expect(TELEMETRY_SCHEMA_VERSION).toBe(2)
    expect(TELEMETRY_EVENT_NAMES).toEqual([
      'application.session_started',
      'auth.logout_selected',
      'feedback.report_issue_opened',
      'feedback.report_issue_submitted',
      'frontend.error',
      'frontend.performance',
      'image.share_selected',
      'image.view.started',
      'image.view.ready',
      'image.view.failed',
      'navigation.page_changed',
    ])
  })
})
