import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CardImagePickerModal from '../../src/components/CardImagePickerModal'
import type { Category } from '../../src/types'

const category: Category = {
  id: 1,
  label: 'Architecture',
  parentId: null,
  children: [
    {
      id: 2,
      label: 'Italian',
      parentId: 1,
      children: [],
      images: [
        {
          id: 20,
          name: 'nested-img.jpg',
          thumb: '/t/20',
          tileSources: '/tiles/20',
          programIds: [],
          active: true,
          sortOrder: 0,
          version: 1,
        },
      ],
      sortOrder: 0,
    },
  ],
  images: [
    {
      id: 10,
      name: 'root-img.jpg',
      thumb: '/t/10',
      tileSources: '/tiles/10',
      programIds: [],
      active: true,
      sortOrder: 0,
      version: 1,
    },
  ],
  sortOrder: 0,
}

const emptyCategory: Category = {
  id: 3,
  label: 'Empty',
  parentId: null,
  children: [],
  images: [],
  sortOrder: 0,
}

describe('CardImagePickerModal', () => {
  it('renders image list from category and children', () => {
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        category={category}
        currentImageId={null}
      />,
    )
    expect(screen.getByText('Choose Card Image')).toBeInTheDocument()
    expect(screen.getByText('root-img.jpg')).toBeInTheDocument()
    expect(screen.getByText('nested-img.jpg')).toBeInTheDocument()
    // Category breadcrumbs
    expect(screen.getByText('Architecture')).toBeInTheDocument()
    expect(screen.getByText('Architecture : Italian')).toBeInTheDocument()
  })

  it('shows empty state when no images exist', () => {
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        category={emptyCategory}
        currentImageId={null}
      />,
    )
    expect(screen.getByText(/no images available/i)).toBeInTheDocument()
  })

  it('selects an image and calls onSave', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        category={category}
        currentImageId={null}
      />,
    )

    await user.click(screen.getByText('root-img.jpg'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(10)
  })

  it('shows Clear button when an image is selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        category={category}
        currentImageId={10}
      />,
    )

    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('cancel calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <CardImagePickerModal
        open
        onClose={onClose}
        onSave={vi.fn()}
        category={category}
        currentImageId={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
