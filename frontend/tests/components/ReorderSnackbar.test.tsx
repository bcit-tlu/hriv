import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import ReorderSnackbar from '../../src/components/ReorderSnackbar'
import type { TileOrderStatus } from '../../src/tileOrdering'

const noopHandlers = {
  onRetry: vi.fn(),
  onAcceptServerOrder: vi.fn(),
  onReapplyLocalOrder: vi.fn(),
  onRetryFailedScopes: vi.fn(),
}

function renderSnackbar(status: TileOrderStatus, otherScopesFailed = false) {
  return render(
    <ReorderSnackbar
      offsetIndex={2}
      status={status}
      otherScopesFailed={otherScopesFailed}
      {...noopHandlers}
    />,
  )
}

describe('ReorderSnackbar', () => {
  it('renders nothing when idle and no cross-scope failures', () => {
    const { container } = renderSnackbar('idle')
    expect(container).toBeEmptyDOMElement()
  })

  it('does not surface intermediate saving states', () => {
    const { container } = renderSnackbar('saving')
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a saved outcome notification', () => {
    renderSnackbar('saved')
    expect(screen.getByRole('status', { name: 'Reorder save state' })).toBeInTheDocument()
    expect(screen.getByText('Order saved')).toBeInTheDocument()
  })

  it('renders an error outcome notification', () => {
    renderSnackbar('error')
    expect(screen.getByRole('status', { name: 'Reorder save state' })).toBeInTheDocument()
    expect(screen.getByText('Could not save order')).toBeInTheDocument()
  })

  it('stacks notifications across successive final statuses', () => {
    const { rerender } = renderSnackbar('saved')
    expect(screen.getAllByRole('status')).toHaveLength(1)

    rerender(
      <ReorderSnackbar
        offsetIndex={2}
        status="error"
        otherScopesFailed={false}
        {...noopHandlers}
      />,
    )
    expect(screen.getAllByRole('status')).toHaveLength(2)

    rerender(
      <ReorderSnackbar
        offsetIndex={2}
        status="saved"
        otherScopesFailed={false}
        {...noopHandlers}
      />,
    )
    expect(screen.getAllByRole('status')).toHaveLength(3)
  })

  it('renders a cross-scope failure notification when other scopes fail', () => {
    renderSnackbar('idle', true)
    expect(screen.getByText('Unresolved order changes in another category')).toBeInTheDocument()
  })
})
