import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  }

  return {
    active: vi.fn(() => ({})),
    fetchInstrumentation: vi.fn(),
    inject: vi.fn(),
    provider: vi.fn(),
    register: vi.fn(),
    registerInstrumentations: vi.fn(),
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
    mocks.provider(attributes)
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
      mocks.provider(config)
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
    expect(mocks.registerInstrumentations).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/api/telemetry/events',
      expect.objectContaining({ keepalive: true }),
    )
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual({
      events: [
        {
          event: 'navigation.page_changed',
          outcome: 'unknown',
          page: 'browse',
          synthetic: true,
        },
      ],
    })
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('batches events and applies explicit synthetic mode', async () => {
    const { emitEvent, setSyntheticMode } = await import('../src/observability')

    setSyntheticMode(true)
    emitEvent({ event: 'image.view.ready', outcome: 'success' })
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/api/telemetry/events',
      expect.objectContaining({
        body: JSON.stringify({
          events: [
            {
              event: 'image.view.ready',
              outcome: 'success',
              synthetic: true,
            },
          ],
        }),
      }),
    )
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
})
