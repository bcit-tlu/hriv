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
  const onReplace = overrides.onReplace ?? undefined
  const result = render(
    <EditImageModal
      open={overrides.open ?? true}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      onReplace={onReplace}
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

describe('EditImageModal – image replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows drop zone text when onReplace is provided', () => {
    const onReplace = vi.fn()
    renderModal({ onReplace })

    expect(screen.getByText('Drag and drop to replace image')).toBeInTheDocument()
    expect(screen.getByText(/browse to upload/)).toBeInTheDocument()
  })

  it('shows Replace & Save button after file is selected', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn().mockResolvedValue(undefined)
    renderModal({ onReplace })

    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    expect(screen.getByText('photo.jpg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace & save/i })).toBeInTheDocument()
  })

  it('shows confirmation warning on first Replace & Save click', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn().mockResolvedValue(undefined)
    renderModal({ onReplace })

    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    const replaceBtn = screen.getByRole('button', { name: /replace & save/i })
    await user.click(replaceBtn)

    await waitFor(() => {
      expect(screen.getByText(/replacing this image will delete/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /confirm replace & save/i })).toBeInTheDocument()
  })

  it('calls onReplace after confirmation', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn().mockResolvedValue(undefined)
    renderModal({ onReplace })

    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    // First click: show confirmation
    const replaceBtn = screen.getByRole('button', { name: /replace & save/i })
    await user.click(replaceBtn)

    // Second click: confirm
    const confirmBtn = screen.getByRole('button', { name: /confirm replace & save/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(onReplace).toHaveBeenCalledTimes(1)
    })
    const callArgs = onReplace.mock.calls[0][0]
    expect(callArgs.file.name).toBe('photo.jpg')
    expect(callArgs.formData.name).toBe('Test Image')
  })

  it('clears selected file when Clear button is clicked', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    renderModal({ onReplace })

    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    expect(screen.getByText('photo.jpg')).toBeInTheDocument()

    const clearBtn = screen.getByRole('button', { name: /clear/i })
    await user.click(clearBtn)

    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument()
    expect(screen.getByText('Drag and drop to replace image')).toBeInTheDocument()
  })

  it('shows Save button when no replacement file is selected', () => {
    const onReplace = vi.fn()
    renderModal({ onReplace })

    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /replace & save/i })).not.toBeInTheDocument()
  })
})
