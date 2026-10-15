import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkEditImagesModal from '../../src/components/BulkEditImagesModal'
import { makeCategory } from '../helpers/fixtures'

function renderModal(overrides: Partial<Parameters<typeof BulkEditImagesModal>[0]> = {}) {
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
      expect(screen.getByText('Failed to delete images. Please try again.')).toBeInTheDocument()
    })
  })

  it('shows an error toast when bulk save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
    renderModal({ onSave })

    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByText('Failed to save changes. Please try again.')).toBeInTheDocument()
    })
  })

  it('drops a pending visibility toggle when the chosen category is hidden', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderModal({
      onSave,
      categories: [
        makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' }),
        makeCategory({ id: 11, label: 'Histology' }),
      ],
    })

    await user.click(screen.getByRole('switch', { name: /visible to students/i }))
    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Anatomy/ }))
    expect(screen.getByRole('switch', { name: /hidden by category/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    // The locked switch's earlier toggle must not leak — only the refile.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category_id: 10 }))
  })

  it('omits a blank note so bulk edits preserve existing notes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderModal({ onSave })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({})
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
    expect(screen.queryByText('Failed to delete images. Please try again.')).not.toBeInTheDocument()
  })
})
