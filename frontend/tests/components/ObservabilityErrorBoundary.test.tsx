import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const emitFrontendErrorMock = vi.fn()

vi.mock('../../src/observability', () => ({
  emitFrontendError: (...args: unknown[]) => emitFrontendErrorMock(...args),
}))

import ObservabilityErrorBoundary from '../../src/components/ObservabilityErrorBoundary'

function ThrowOnRender() {
  throw new Error('boom')
}

describe('ObservabilityErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    emitFrontendErrorMock.mockReset()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders children when no error occurs', () => {
    render(
      <ObservabilityErrorBoundary>
        <div>safe child</div>
      </ObservabilityErrorBoundary>,
    )

    expect(screen.getByText('safe child')).toBeInTheDocument()
    expect(emitFrontendErrorMock).not.toHaveBeenCalled()
  })

  it('shows the fallback alert and emits telemetry when a child throws', () => {
    render(
      <ObservabilityErrorBoundary>
        <ThrowOnRender />
      </ObservabilityErrorBoundary>,
    )

    expect(
      screen.getByText('HRIV ran into an unexpected problem. Refresh the page and try again.'),
    ).toBeInTheDocument()
    expect(emitFrontendErrorMock).toHaveBeenCalledOnce()
    expect(emitFrontendErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'render',
        error: 'react',
        errorCode: 'react_render_error',
      }),
    )
    const [telemetry] = emitFrontendErrorMock.mock.calls[0] ?? []
    expect(telemetry).toMatchObject({
      dedupeKey: expect.stringContaining('react_render_error:Error:boom:at ThrowOnRender'),
    })
    expect(telemetry.dedupeKey.length).toBeLessThanOrEqual(240)
  })
})
