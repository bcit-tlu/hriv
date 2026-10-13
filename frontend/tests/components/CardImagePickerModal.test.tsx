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
          active: true,
          sortOrder: 0,
          version: 1,
        },
      ],
      programIds: [],
      groupIds: [],
      sortOrder: 0,
      version: 1,
    },
  ],
  images: [
    {
      id: 10,
      name: 'root-img.jpg',
      thumb: '/t/10',
      tileSources: '/tiles/10',
      active: true,
      sortOrder: 0,
      version: 1,
    },
  ],
  programIds: [],
  groupIds: [],
  sortOrder: 0,
  version: 1,
}

const visibilityCategory: Category = {
  id: 10,
  label: 'Root',
  parentId: null,
  children: [
    {
      id: 11,
      label: 'Hidden Child',
      parentId: 10,
      children: [],
      images: [
        {
          id: 30,
          name: 'hidden-child-img.jpg',
          thumb: '/t/30',
          tileSources: '/tiles/30',
          active: true,
          sortOrder: 0,
          version: 1,
        },
      ],
      programIds: [],
      groupIds: [],
      status: 'hidden',
      sortOrder: 0,
      version: 1,
    },
    {
      id: 12,
      label: 'Restricted Child',
      parentId: 10,
      children: [
        {
          id: 13,
          label: 'Open Grandchild',
          parentId: 12,
          children: [],
          images: [
            {
              id: 40,
              name: 'inherited-restriction-img.jpg',
              thumb: '/t/40',
              tileSources: '/tiles/40',
              active: true,
              sortOrder: 0,
              version: 1,
            },
          ],
          programIds: [],
          groupIds: [],
          sortOrder: 0,
          version: 1,
        },
      ],
      images: [],
      programIds: [5],
      groupIds: [],
      sortOrder: 0,
      version: 1,
    },
  ],
  images: [
    {
      id: 20,
      name: 'open-img.jpg',
      thumb: '/t/20',
      tileSources: '/tiles/20',
      active: true,
      sortOrder: 0,
      version: 1,
    },
    {
      id: 21,
      name: 'inactive-img.jpg',
      thumb: '/t/21',
      tileSources: '/tiles/21',
      active: false,
      sortOrder: 0,
      version: 1,
    },
  ],
  programIds: [],
  groupIds: [],
  sortOrder: 0,
  version: 1,
}

const emptyCategory: Category = {
  id: 3,
  label: 'Empty',
  parentId: null,
  children: [],
  images: [],
  programIds: [],
  groupIds: [],
  sortOrder: 0,
  version: 1,
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

  it('flags images that are not student-visible (#1609)', () => {
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        category={visibilityCategory}
        currentImageId={null}
      />,
    )
    const icons = screen.getAllByTestId('limited-visibility-icon')
    // inactive image + hidden child + restricted grandchild (inherited).
    expect(icons).toHaveLength(3)
    for (const name of [
      'inactive-img.jpg',
      'hidden-child-img.jpg',
      'inherited-restriction-img.jpg',
    ]) {
      const row = screen.getByText(name).closest('tr')!
      expect(row.querySelector('[data-testid="limited-visibility-icon"]')).not.toBeNull()
    }
    // The helper sentence appears once when any row is flagged.
    expect(screen.getByText(/Hidden or restricted for some students/)).toBeInTheDocument()
  })

  it('does not flag unrestricted active images', () => {
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        category={visibilityCategory}
        currentImageId={null}
      />,
    )
    const openRow = screen.getByText('open-img.jpg').closest('tr')!
    expect(openRow.querySelector('[data-testid="limited-visibility-icon"]')).toBeNull()
  })

  it('shows the limited-visibility tooltip on the flag icon', async () => {
    const user = userEvent.setup()
    render(
      <CardImagePickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        category={visibilityCategory}
        currentImageId={null}
      />,
    )
    await user.hover(screen.getAllByTestId('limited-visibility-icon')[0])
    const tooltips = await screen.findAllByText(
      /they will still see this cover as the tile thumbnail/,
    )
    expect(tooltips.length).toBeGreaterThan(0)
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
