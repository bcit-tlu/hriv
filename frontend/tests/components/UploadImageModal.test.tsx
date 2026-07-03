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
import { uploadSourceImage } from '../../src/api'
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
})
