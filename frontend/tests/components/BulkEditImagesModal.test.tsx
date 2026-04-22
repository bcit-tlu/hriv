import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkEditImagesModal from '../../src/components/BulkEditImagesModal'

function renderModal(
  overrides: Partial<Parameters<typeof BulkEditImagesModal>[0]> = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSave = overrides.onSave ?? vi.fn()
  const onDelete = overrides.onDelete ?? vi.fn()
  const result = render(
    <BulkEditImagesModal
      open={overrides.open ?? true}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      categories={overrides.categories ?? []}
      programs={overrides.programs ?? []}
      selectedCount={overrides.selectedCount ?? 3}
    />,
  )
  return { ...result, onClose, onSave, onDelete }
}

describe('BulkEditImagesModal – delete error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an error toast when bulk delete fails', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockRejectedValue(new Error('Server error'))
    renderModal({ onDelete })

    const deleteBtn = screen.getByRole('button', { name: /delete 3 selected/i })
    await user.click(deleteBtn)

    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(
        screen.getByText('Failed to delete images. Please try again.'),
      ).toBeInTheDocument()
    })
  })

  it('does not show an error toast when bulk delete succeeds', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderModal({ onDelete })

    const deleteBtn = screen.getByRole('button', { name: /delete 3 selected/i })
    await user.click(deleteBtn)

    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
    expect(
      screen.queryByText('Failed to delete images. Please try again.'),
    ).not.toBeInTheDocument()
  })
})
