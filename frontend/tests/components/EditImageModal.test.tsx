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
  active: true,
  sort_order: 0,
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
      onCancelReplace={overrides.onCancelReplace}
      replaceUploadProgress={overrides.replaceUploadProgress}
      image={overrides.image ?? baseImage}
      categories={overrides.categories ?? []}
      programs={overrides.programs ?? []}
      groups={overrides.groups}
      onAddCategory={overrides.onAddCategory}
      onEditCategory={overrides.onEditCategory}
      onToggleVisibility={overrides.onToggleVisibility}
      onViewImage={overrides.onViewImage}
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

// ---------------------------------------------------------------------------
// Tests — form fields and save
// ---------------------------------------------------------------------------

describe('EditImageModal – form fields and save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all form fields with initial values', () => {
    renderModal({
      image: {
        ...baseImage,
        name: 'My Image',
        copyright: '© 2026',
        note: 'Test note',
      },
    })

    expect(screen.getByDisplayValue('My Image')).toBeInTheDocument()
    expect(screen.getByDisplayValue('© 2026')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test note')).toBeInTheDocument()
  })

  it('calls onSave with form data when Save is clicked', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Image',
        category_id: null,
        active: true,
      }),
    )
  })

  it('disables Save when name is empty', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    const nameInput = screen.getByDisplayValue('Test Image')
    await user.clear(nameInput)

    // Save button should be disabled when name is empty
    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    expect(saveBtn).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('updates copyright field', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    const copyrightInput = screen.getByLabelText('Copyright')
    await user.type(copyrightInput, '© BCIT 2026')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ copyright: '© BCIT 2026' }),
    )
  })

  it('updates note field', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    const noteInput = screen.getByLabelText('Note')
    await user.type(noteInput, 'A sample note')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'A sample note' }),
    )
  })

  it('toggles active switch', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    const visSwitch = screen.getByRole('switch', { name: /visible to students/i })
    expect(visSwitch).toBeChecked()

    await user.click(visSwitch)
    expect(visSwitch).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ active: false }),
    )
  })

  it('includes measurement_scale and measurement_unit in metadata_extra', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    const scaleInput = screen.getByLabelText('Scale (px per unit)')
    const unitInput = screen.getByLabelText('Unit')

    await user.type(scaleInput, '2.5')
    await user.type(unitInput, 'mm')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_extra: expect.objectContaining({
          measurement_scale: 2.5,
          measurement_unit: 'mm',
        }),
      }),
    )
  })

  it('renders Created and Modified timestamps', () => {
    renderModal({
      image: {
        ...baseImage,
        created_at: '2026-01-15T10:30:00Z',
        updated_at: '2026-02-20T14:00:00Z',
      },
    })

    expect(screen.getByText('Created:')).toBeInTheDocument()
    expect(screen.getByText('Modified:')).toBeInTheDocument()
  })

  it('renders measurement settings section', () => {
    renderModal()
    expect(screen.getByText('Measurement Settings')).toBeInTheDocument()
    expect(screen.getByLabelText('Scale (px per unit)')).toBeInTheDocument()
    expect(screen.getByLabelText('Unit')).toBeInTheDocument()
  })

  it('pre-populates measurement fields from metadata_extra', () => {
    renderModal({
      image: {
        ...baseImage,
        metadata_extra: { measurement_scale: 5.0, measurement_unit: 'um' },
      },
    })

    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByDisplayValue('um')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — View Image with unsaved changes
// ---------------------------------------------------------------------------

describe('EditImageModal – View Image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders View Image button when onViewImage is provided', () => {
    renderModal({ onViewImage: vi.fn() })
    expect(screen.getByRole('button', { name: /view image/i })).toBeInTheDocument()
  })

  it('does not render View Image button when onViewImage is omitted', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /view image/i })).not.toBeInTheDocument()
  })

  it('calls onViewImage directly when form is not dirty', async () => {
    const user = userEvent.setup()
    const onViewImage = vi.fn()
    renderModal({ onViewImage })

    await user.click(screen.getByRole('button', { name: /view image/i }))
    expect(onViewImage).toHaveBeenCalledTimes(1)
  })

  it('shows unsaved changes warning when form is dirty', async () => {
    const user = userEvent.setup()
    const onViewImage = vi.fn()
    renderModal({ onViewImage })

    // Make the form dirty by changing the name
    const nameInput = screen.getByDisplayValue('Test Image')
    await user.type(nameInput, ' modified')

    await user.click(screen.getByRole('button', { name: /view image/i }))

    expect(onViewImage).not.toHaveBeenCalled()
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard & view/i })).toBeInTheDocument()
  })

  it('calls onViewImage when Discard & View is clicked', async () => {
    const user = userEvent.setup()
    const onViewImage = vi.fn()
    renderModal({ onViewImage })

    const nameInput = screen.getByDisplayValue('Test Image')
    await user.type(nameInput, ' modified')

    await user.click(screen.getByRole('button', { name: /view image/i }))
    await user.click(screen.getByRole('button', { name: /discard & view/i }))

    expect(onViewImage).toHaveBeenCalledTimes(1)
  })

  it('cancels unsaved changes warning', async () => {
    const user = userEvent.setup()
    const onViewImage = vi.fn()
    renderModal({ onViewImage })

    const nameInput = screen.getByDisplayValue('Test Image')
    await user.type(nameInput, ' modified')

    await user.click(screen.getByRole('button', { name: /view image/i }))
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()

    // Click the Cancel button within the warning bar (first Cancel since it appears above the dialog actions)
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i })
    // The warning bar Cancel is the last one added to the DOM
    await user.click(cancelButtons[0])

    await waitFor(() => {
      expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument()
    })
    expect(onViewImage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests — replace error handling
// ---------------------------------------------------------------------------

describe('EditImageModal – replace error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows error alert when replace fails', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn().mockRejectedValue(new Error('Upload failed'))
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
      expect(screen.getByText('Failed to replace image. Please try again.')).toBeInTheDocument()
    })
  })

  it('shows upload progress bar when replaceUploadProgress is set', () => {
    renderModal({
      onReplace: vi.fn(),
      replaceUploadProgress: 0.45,
    })

    expect(screen.getByText(/uploading replacement/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — dialog open/close
// ---------------------------------------------------------------------------

describe('EditImageModal – dialog behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render content when open is false', () => {
    renderModal({ open: false })
    expect(screen.queryByText('Edit Details')).not.toBeInTheDocument()
  })

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render form when open is false', () => {
    renderModal({ open: false })
    expect(screen.queryByText('Edit Details')).not.toBeInTheDocument()
  })
})
