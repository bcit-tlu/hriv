/**
 * Unit tests for the CategoryTile component.
 *
 * Covers:
 * 1. Basic rendering — category label, detail text, and card structure
 * 2. Hidden indicator — dimmed title and DisabledVisible icon when status='hidden'
 * 3. Visible categories — no hidden indicator when status is not 'hidden'
 * 4. Card image — renders thumbnail when cardImageId is set
 * 5. Program chips — renders program labels from descendant images
 * 6. Detail text — correct sub-category and image counts
 * 7. Move button — renders and calls callback
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryTile from '../../src/components/CategoryTile'
import type { Category, Program } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    label: 'Test Category',
    parentId: null,
    children: [],
    images: [],
    status: null,
    cardImageId: null,
    ...overrides,
  }
}

const samplePrograms: Program[] = [
  { id: 10, name: 'Pathology', created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: 20, name: 'Radiology', created_at: '2024-01-01', updated_at: '2024-01-01' },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoryTile', () => {
  // ─── Basic rendering ──────────────────────────────────────────────

  describe('basic rendering', () => {
    it('renders the category label', () => {
      render(<CategoryTile category={makeCategory()} onClick={vi.fn()} programs={[]} />)
      expect(screen.getByText('Test Category')).toBeInTheDocument()
    })

    it('shows "Empty" when there are no children or images', () => {
      render(<CategoryTile category={makeCategory()} onClick={vi.fn()} programs={[]} />)
      expect(screen.getByText('Empty')).toBeInTheDocument()
    })

    it('calls onClick when the card is clicked', async () => {
      const user = userEvent.setup()
      const category = makeCategory()
      const onClick = vi.fn()
      render(<CategoryTile category={category} onClick={onClick} programs={[]} />)

      await user.click(screen.getByText('Test Category'))
      expect(onClick).toHaveBeenCalledWith(category)
    })
  })

  // ─── Hidden indicator ─────────────────────────────────────────────

  describe('hidden indicator', () => {
    it('shows the hidden icon when category status is hidden', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: 'hidden' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByTestId('DisabledVisibleIcon')).toBeInTheDocument()
    })

    it('dims the title text when category is hidden', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: 'hidden', label: 'Hidden Cat' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Hidden Cat')
      expect(title).toHaveStyle({ opacity: 0.5 })
    })

    it('does not show the hidden icon when category is visible', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: null })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.queryByTestId('DisabledVisibleIcon')).not.toBeInTheDocument()
    })

    it('title has full opacity when category is visible', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: null, label: 'Visible Cat' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Visible Cat')
      expect(title).toHaveStyle({ opacity: 1 })
    })
  })

  // ─── Detail text ──────────────────────────────────────────────────

  describe('detail text', () => {
    it('shows sub-category count', () => {
      render(
        <CategoryTile
          category={makeCategory({
            children: [
              makeCategory({ id: 2, label: 'Child 1' }),
              makeCategory({ id: 3, label: 'Child 2' }),
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByText(/2 sub-categories/)).toBeInTheDocument()
    })

    it('shows singular sub-category text for one child', () => {
      render(
        <CategoryTile
          category={makeCategory({
            children: [makeCategory({ id: 2, label: 'Child' })],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByText(/1 sub-category/)).toBeInTheDocument()
    })

    it('counts all descendant subcategories recursively', () => {
      render(
        <CategoryTile
          category={makeCategory({
            children: [
              makeCategory({
                id: 2,
                label: 'B',
                children: [
                  makeCategory({ id: 4, label: 'D' }),
                  makeCategory({ id: 5, label: 'E' }),
                  makeCategory({ id: 6, label: 'F' }),
                ],
              }),
              makeCategory({ id: 3, label: 'C' }),
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      // 2 direct children + 3 grandchildren = 5
      expect(screen.getByText(/5 sub-categories/)).toBeInTheDocument()
    })

    it('shows image count', () => {
      render(
        <CategoryTile
          category={makeCategory({
            images: [
              { id: 1, name: 'Img1', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
              { id: 2, name: 'Img2', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
              { id: 3, name: 'Img3', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByText(/3 images/)).toBeInTheDocument()
    })

    it('shows singular image text for one image', () => {
      render(
        <CategoryTile
          category={makeCategory({
            images: [
              { id: 1, name: 'Img1', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByText(/1 image/)).toBeInTheDocument()
    })

    it('counts all descendant images recursively', () => {
      render(
        <CategoryTile
          category={makeCategory({
            images: [
              { id: 1, name: 'Img1', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
            ],
            children: [
              makeCategory({
                id: 2,
                label: 'Child',
                images: [
                  { id: 2, name: 'Img2', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
                  { id: 3, name: 'Img3', thumb: '', tileSources: '', programIds: [], active: true, version: 1 },
                ],
              }),
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      // 1 direct + 2 in child = 3
      expect(screen.getByText(/3 images/)).toBeInTheDocument()
    })
  })

  // ─── Program chips ────────────────────────────────────────────────

  describe('program chips', () => {
    it('renders program chips from image programIds', () => {
      render(
        <CategoryTile
          category={makeCategory({
            images: [
              { id: 1, name: 'Img', thumb: '', tileSources: '', programIds: [10, 20], active: true, version: 1 },
            ],
          })}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      expect(screen.getByText('Pathology')).toBeInTheDocument()
      expect(screen.getByText('Radiology')).toBeInTheDocument()
    })

    it('does not render program chips when no images have programIds', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      expect(screen.queryByText('Pathology')).not.toBeInTheDocument()
    })
  })

  // ─── Card image ───────────────────────────────────────────────────

  describe('card image', () => {
    it('renders the folder icon when no card image is set', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByTestId('FolderIcon')).toBeInTheDocument()
    })

    it('renders the thumbnail when cardImageId matches an image', () => {
      render(
        <CategoryTile
          category={makeCategory({
            cardImageId: 5,
            images: [
              { id: 5, name: 'Card Img', thumb: '/thumbs/card.jpg', tileSources: '', programIds: [], active: true, version: 1 },
            ],
          })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const img = screen.getByAltText('Test Category')
      expect(img).toHaveAttribute('src', '/thumbs/card.jpg')
    })
  })

  // ─── Move button ──────────────────────────────────────────────────

  describe('move button', () => {
    it('renders the move button when onMove is provided', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={[]}
          onMove={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Move category')).toBeInTheDocument()
    })

    it('calls onMove when the move button is clicked', async () => {
      const user = userEvent.setup()
      const category = makeCategory()
      const onMove = vi.fn()
      render(
        <CategoryTile
          category={category}
          onClick={vi.fn()}
          programs={[]}
          onMove={onMove}
        />,
      )

      await user.click(screen.getByLabelText('Move category'))
      expect(onMove).toHaveBeenCalledWith(category)
    })

    it('does not render the move button when onMove is not provided', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.queryByLabelText('Move category')).not.toBeInTheDocument()
    })
  })
})
