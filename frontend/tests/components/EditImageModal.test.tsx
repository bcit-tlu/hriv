import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditImageModal from '../../src/components/EditImageModal'
import type { ApiImage } from '../../src/api'

const baseImage: ApiImage = {
  id: 1,
  name: 'Test Image',
  thumb: '/thumb/1.jpg',
  tile_sources: '/tiles/1',
  category_id: null,
  copyright: null,
  note: null,
  program_ids: [],
  active: true,
  metadata_extra: null,
  version: 1,
  width: 100,
  height: 100,
  file_size: 1024,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderModal(
  overrides: Partial<Parameters<typeof EditImageModal>[0]> = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSave = overrides.onSave ?? vi.fn()
  const onDelete = overrides.onDelete ?? vi.fn()
  const result = render(
    <EditImageModal
      open={overrides.open ?? true}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      image={overrides.image ?? baseImage}
      categories={overrides.categories ?? []}
      programs={overrides.programs ?? []}
    />,
  )
  return { ...result, onClose, onSave, onDelete }
}

describe('EditImageModal – delete error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an error toast when delete fails', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockRejectedValue(new Error('Server error'))
    renderModal({ onDelete })

    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    await user.click(deleteBtn)

    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(
        screen.getByText('Failed to delete image. Please try again.'),
      ).toBeInTheDocument()
    })
  })

  it('does not show an error toast when delete succeeds', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderModal({ onDelete })

    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    await user.click(deleteBtn)

    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
    expect(
      screen.queryByText('Failed to delete image. Please try again.'),
    ).not.toBeInTheDocument()
  })
})
