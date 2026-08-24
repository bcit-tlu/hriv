import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import ReorderSnackbar from '../../src/components/ReorderSnackbar'

const noopHandlers = {
  onRetry: vi.fn(),
  onAcceptServerOrder: vi.fn(),
  onReapplyLocalOrder: vi.fn(),
}

describe('ReorderSnackbar', () => {
  it('renders nothing when idle and no cross-scope failures', () => {
    const { container } = render(
      <ReorderSnackbar offsetIndex={2} status="idle" {...noopHandlers} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the reorder status in a bottom-right snackbar', () => {
    render(<ReorderSnackbar offsetIndex={3} status="saving" {...noopHandlers} />)
    expect(screen.getByRole('status', { name: 'Reorder save state' })).toBeInTheDocument()
    expect(screen.getByText('Saving order…')).toBeInTheDocument()
  })
})
