import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ReorderStatusIndicator from '../../src/components/ReorderStatusIndicator'
import type { TileOrderStatus } from '../../src/tileOrdering'

function renderIndicator(status: TileOrderStatus) {
  const onRetry = vi.fn()
  const onAcceptServerOrder = vi.fn()
  const result = render(
    <ReorderStatusIndicator
      status={status}
      onRetry={onRetry}
      onAcceptServerOrder={onAcceptServerOrder}
    />,
  )
  return { ...result, onRetry, onAcceptServerOrder }
}

describe('ReorderStatusIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = renderIndicator('idle')
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "Unsaved order" when dirty', () => {
    renderIndicator('dirty')
    expect(screen.getByText('Unsaved order')).toBeInTheDocument()
  })

  it.each(['saving', 'dirty-while-saving'] as const)('shows "Saving order…" when %s', (status) => {
    renderIndicator(status)
    expect(screen.getByText('Saving order…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows "Order saved" when saved', () => {
    renderIndicator('saved')
    expect(screen.getByText('Order saved')).toBeInTheDocument()
  })

  it('shows the conflict message with a Refresh button wired to onAcceptServerOrder', () => {
    const { onAcceptServerOrder, onRetry } = renderIndicator('conflict')
    expect(screen.getByText('Order changed elsewhere')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onAcceptServerOrder).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('shows the error message with a Retry button wired to onRetry', () => {
    const { onRetry, onAcceptServerOrder } = renderIndicator('error')
    expect(screen.getByText('Could not save order')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onAcceptServerOrder).not.toHaveBeenCalled()
  })

  it('exposes a status region for assistive technology', () => {
    renderIndicator('saved')
    expect(screen.getByRole('status', { name: 'Reorder save state' })).toBeInTheDocument()
  })

  it('surfaces failed scopes elsewhere while idle', () => {
    const onRetryFailedScopes = vi.fn()
    render(
      <ReorderStatusIndicator
        status="idle"
        onRetry={vi.fn()}
        onAcceptServerOrder={vi.fn()}
        otherScopesFailed
        onRetryFailedScopes={onRetryFailedScopes}
      />,
    )
    expect(screen.getByText('Unresolved order changes in another category')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onRetryFailedScopes).toHaveBeenCalledTimes(1)
  })

  it('keeps the cross-scope Resolve affordance visible alongside a non-idle status', () => {
    const onRetryFailedScopes = vi.fn()
    render(
      <ReorderStatusIndicator
        status="error"
        onRetry={vi.fn()}
        onAcceptServerOrder={vi.fn()}
        otherScopesFailed
        onRetryFailedScopes={onRetryFailedScopes}
      />,
    )
    expect(screen.getByText('Could not save order')).toBeInTheDocument()
    expect(screen.getByText('Unresolved order changes in another category')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onRetryFailedScopes).toHaveBeenCalledTimes(1)
  })
})
