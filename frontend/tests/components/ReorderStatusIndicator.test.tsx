import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ReorderStatusIndicator from '../../src/components/ReorderStatusIndicator'
import type { TileOrderStatus } from '../../src/tileOrdering'

function renderIndicator(status: TileOrderStatus) {
  const onRetry = vi.fn()
  const onAcceptServerOrder = vi.fn()
  const onReapplyLocalOrder = vi.fn()
  const result = render(
    <ReorderStatusIndicator
      status={status}
      onRetry={onRetry}
      onAcceptServerOrder={onAcceptServerOrder}
      onReapplyLocalOrder={onReapplyLocalOrder}
    />,
  )
  return { ...result, onRetry, onAcceptServerOrder, onReapplyLocalOrder }
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

  it('shows a "Keep my order" button wired to onReapplyLocalOrder in conflict', () => {
    const { onReapplyLocalOrder, onAcceptServerOrder } = renderIndicator('conflict')
    fireEvent.click(screen.getByRole('button', { name: 'Keep my order' }))
    expect(onReapplyLocalOrder).toHaveBeenCalledTimes(1)
    expect(onAcceptServerOrder).not.toHaveBeenCalled()
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
})
