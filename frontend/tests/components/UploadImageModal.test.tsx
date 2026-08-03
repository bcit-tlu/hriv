import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    uploadSourceImage: vi.fn(),
    bulkImportImages: vi.fn(),
  }
})

// CategoryPickerSelect uses canvas internally; mock it
vi.mock('../../src/components/CategoryPickerSelect', () => ({
  default: () => <div data-testid="category-picker" />,
}))

import UploadImageModal from '../../src/components/UploadImageModal'
import { uploadSourceImage, bulkImportImages } from '../../src/api'
import type { Category, Program } from '../../src/types'

const categories: Category[] = [
  {
    id: 1,
    label: 'Root',
    parentId: null,
    children: [],
    images: [],
    programIds: [],
    groupIds: [],
    sortOrder: 0,
    version: 1,
    cardImageId: null,
    hidden: false,
  },
]

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

describe('UploadImageModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and upload area when open', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )
    expect(screen.getByText('Add Images')).toBeInTheDocument()
    expect(screen.getByText(/drag.*drop|choose.*files/i)).toBeInTheDocument()
  })

  it('renders Cancel button', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('renders category picker', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )
    expect(screen.getByTestId('category-picker')).toBeInTheDocument()
  })

  it('renders combined helper text', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )
    expect(
      screen.getByText(/Uploaded images are processed into zoomable views/),
    ).toBeInTheDocument()
    expect(screen.getByText(/ZIP uploads are automatically extracted/)).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <UploadImageModal
        open={false}
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('submits from the Name field when Enter is pressed', async () => {
    vi.mocked(uploadSourceImage).mockResolvedValue({
      id: 123,
    } as never)

    const user = userEvent.setup()
    const onUploaded = vi.fn()
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={onUploaded}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const file = new File(['image-data'], 'slide.png', { type: 'image/png' })
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } })

    const nameField = await screen.findByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Edited slide')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(uploadSourceImage).toHaveBeenCalledTimes(1)
    })
    expect(uploadSourceImage).toHaveBeenCalledWith(
      file,
      'Edited slide',
      undefined,
      undefined,
      undefined,
      true,
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('switches to bulk mode with chips and imports multiple files', async () => {
    const job = { id: 7 } as never
    vi.mocked(bulkImportImages).mockResolvedValue(job)

    const user = userEvent.setup()
    const onClose = vi.fn()
    const onBulkImportStarted = vi.fn()
    const onUploadStarted = vi.fn()
    render(
      <UploadImageModal
        open
        onClose={onClose}
        onUploaded={vi.fn()}
        onBulkImportStarted={onBulkImportStarted}
        onUploadStarted={onUploadStarted}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const a = new File(['a'], 'a.png', { type: 'image/png' })
    const b = new File(['bb'], 'b.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [a, b] } })

    expect(screen.getByText('2 files selected')).toBeInTheDocument()
    expect(screen.getByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('b.jpg')).toBeInTheDocument()
    // Name field is hidden in bulk mode
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import 2 files' }))

    await waitFor(() => expect(bulkImportImages).toHaveBeenCalledTimes(1))
    expect(onUploadStarted).toHaveBeenCalledWith(expect.any(Number), '2 files', 3)
    expect(onBulkImportStarted).toHaveBeenCalledWith(job, '2 files', 3, expect.any(Number))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('treats a single zip file as bulk mode', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const zip = new File(['zip-data'], 'batch.zip', { type: 'application/zip' })
    fireEvent.change(fileInput, { target: { files: [zip] } })

    expect(screen.getByRole('button', { name: 'Import 1 file' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('returns to single-image mode when a chip is removed', async () => {
    const user = userEvent.setup()
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const a = new File(['a'], 'first.png', { type: 'image/png' })
    const b = new File(['b'], 'second.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [a, b] } })

    const chip = screen.getByText('second.png').closest('.MuiChip-root') as HTMLElement
    await user.click(chip.querySelector('svg') as Element)

    // Back in single mode: name auto-filled from the remaining file
    expect(await screen.findByLabelText('Name')).toHaveValue('first')
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('accepts files dropped onto the drop zone', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )

    const dropZone = screen.getByText(/Drag and drop images/).parentElement as HTMLElement
    const file = new File(['x'], 'dropped.png', { type: 'image/png' })
    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } })
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    expect(screen.getByText('dropped.png')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('dropped')
  })

  it('ignores dropped files with unsupported types', () => {
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
      />,
    )

    const dropZone = screen.getByText(/Drag and drop images/).parentElement as HTMLElement
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    expect(screen.getByText(/Drag and drop images/)).toBeInTheDocument()
  })

  it('pre-populates from initialFiles and derives the name', () => {
    const file = new File(['x'], 'preloaded.png', { type: 'image/png' })
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        categories={categories}
        programs={programs}
        initialFiles={[file]}
      />,
    )

    expect(screen.getByText('preloaded.png')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('preloaded')
  })

  it('shows an error alert and notifies onUploadFailed when a single upload fails', async () => {
    vi.mocked(uploadSourceImage).mockRejectedValue(new Error('disk full'))
    // userMessage falls back to the generic message for plain Errors

    const user = userEvent.setup()
    const onUploadFailed = vi.fn()
    const onClose = vi.fn()
    render(
      <UploadImageModal
        open
        onClose={onClose}
        onUploaded={vi.fn()}
        onUploadFailed={onUploadFailed}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'fail.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed')
    expect(onUploadFailed).toHaveBeenCalledWith(expect.any(Number), 'Upload failed')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes quietly when a bulk upload is cancelled via Cancel', async () => {
    let rejectUpload: (err: unknown) => void = () => {}
    vi.mocked(bulkImportImages).mockImplementation(
      (_files, _cat, _c, _n, _a, _p, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }) as never,
    )

    const user = userEvent.setup()
    const onClose = vi.fn()
    const onUploadFailed = vi.fn()
    render(
      <UploadImageModal
        open
        onClose={onClose}
        onUploaded={vi.fn()}
        onUploadFailed={onUploadFailed}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const a = new File(['a'], 'a.png', { type: 'image/png' })
    const b = new File(['b'], 'b.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [a, b] } })

    await user.click(screen.getByRole('button', { name: 'Import 2 files' }))
    expect(await screen.findByRole('button', { name: 'Uploading...' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(onUploadFailed).toHaveBeenCalledWith(expect.any(Number), 'Upload cancelled'),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(rejectUpload).toBeDefined()
  })

  it('reports upload progress with formatted byte counts', async () => {
    let emitProgress: (fraction: number) => void = () => {}
    vi.mocked(uploadSourceImage).mockImplementation(
      (_file, _name, _cat, _c, _n, _a, onProgress?: (fraction: number) => void) => {
        emitProgress = onProgress ?? emitProgress
        return new Promise(() => {}) as never
      },
    )

    const user = userEvent.setup()
    const onUploadProgress = vi.fn()
    render(
      <UploadImageModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        onUploadProgress={onUploadProgress}
        categories={categories}
        programs={programs}
      />,
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(2048)], 'big.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(uploadSourceImage).toHaveBeenCalledTimes(1))

    emitProgress(0.5)
    expect(await screen.findByText(/Uploading: 50%/)).toBeInTheDocument()
    expect(onUploadProgress).toHaveBeenCalledWith(expect.any(Number), 0.5)
  })
})
