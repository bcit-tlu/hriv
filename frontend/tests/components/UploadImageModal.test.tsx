import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

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
import type { Category, Program } from '../../src/types'

const categories: Category[] = [
  {
    id: 1,
    label: 'Root',
    parentId: null,
    children: [],
    images: [],
    sortOrder: 0,
    cardImageId: null,
    hidden: false,
  },
]

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', created_at: '', updated_at: '' },
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
})
