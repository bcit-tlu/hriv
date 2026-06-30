/**
 * Unit tests for the CategoryTile component.
 *
 * Covers:
 * 1. Basic rendering — category label, detail text, and card structure
 * 2. Hidden indicator — greyscale card and VisibilityOff icon when status='hidden'
 * 3. Visible categories — no hidden indicator when status is not 'hidden'
 * 4. Card image — renders thumbnail when cardImageId is set
 * 5. Program chips — renders program labels from category's own programIds only
 * 6. Detail text — correct sub-category and image counts
 * 7. Move button — renders and calls callback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useMediaQuery from '@mui/material/useMediaQuery'
import CategoryTile from '../../src/components/CategoryTile'
import type { Group, Program } from '../../src/types'

vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)
import { makeCategory } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const samplePrograms: Program[] = [
  {
    id: 10,
    name: 'Pathology',
    oidc_group: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
  {
    id: 20,
    name: 'Radiology',
    oidc_group: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
]

const sampleGroups: Group[] = [
  {
    id: 30,
    name: 'Lab A2',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    id: 40,
    name: 'Seminar B',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
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
    it('renders the card in greyscale when category is hidden', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: 'hidden', label: 'Hidden Cat' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Hidden Cat')
      expect(title.closest('.MuiCardActionArea-root')).toHaveStyle({ filter: 'grayscale(100%)' })
    })

    it('shows the hidden icon when category is directly hidden', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: 'hidden' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByTestId('VisibilityOffIcon')).toBeInTheDocument()
      expect(screen.queryByTestId('VisibilityIcon')).not.toBeInTheDocument()
    })

    it('does not apply greyscale when category is visible', () => {
      render(
        <CategoryTile
          category={makeCategory({ status: null, label: 'Visible Cat' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Visible Cat')
      expect(title.closest('.MuiCardActionArea-root')).toHaveStyle({ filter: 'none' })
    })

    it('reduces tile opacity when hidden state is inherited from a parent page', () => {
      render(
        <CategoryTile
          category={makeCategory({
            label: 'Inherited Hidden Cat',
            programIds: [10],
          })}
          onClick={vi.fn()}
          programs={samplePrograms}
          parentHidden
          inheritedHidden
        />,
      )
      const title = screen.getByText('Inherited Hidden Cat')
      const card = title.closest('.MuiCard-root')
      const actionArea = title.closest('.MuiCardActionArea-root')

      expect(card).toHaveStyle({ opacity: '0.5' })
      expect(actionArea).toHaveStyle({ filter: 'grayscale(100%)' })
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
              {
                id: 1,
                name: 'Img1',
                thumb: '',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
              {
                id: 2,
                name: 'Img2',
                thumb: '',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
              {
                id: 3,
                name: 'Img3',
                thumb: '',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
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
              {
                id: 1,
                name: 'Img1',
                thumb: '',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
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
              {
                id: 1,
                name: 'Img1',
                thumb: '',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
            ],
            children: [
              makeCategory({
                id: 2,
                label: 'Child',
                images: [
                  {
                    id: 2,
                    name: 'Img2',
                    thumb: '',
                    tileSources: '',
                    active: true,
                    sortOrder: 0,
                    version: 1,
                  },
                  {
                    id: 3,
                    name: 'Img3',
                    thumb: '',
                    tileSources: '',
                    active: true,
                    sortOrder: 0,
                    version: 1,
                  },
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
    it('renders program chips only from category own programIds', () => {
      render(
        <CategoryTile
          category={makeCategory({ programIds: [10, 20] })}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      expect(screen.getByText('Pathology')).toBeInTheDocument()
      expect(screen.getByText('Radiology')).toBeInTheDocument()
    })

    it('does not render program chips when programIds is empty', () => {
      render(<CategoryTile category={makeCategory()} onClick={vi.fn()} programs={samplePrograms} />)
      expect(screen.queryByText('Pathology')).not.toBeInTheDocument()
    })

    it('renders inherited program chips when the restriction comes from an ancestor', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={samplePrograms}
          inheritedProgramIds={[10]}
        />,
      )

      const chip = screen.getByText('Pathology').closest('.MuiChip-root')
      expect(chip).toBeInTheDocument()
      expect(chip).toHaveStyle({ opacity: '0.6' })
    })
  })

  describe('group chips', () => {
    it('renders group chips from category own groupIds', () => {
      render(
        <CategoryTile
          category={makeCategory({ groupIds: [30, 40] })}
          onClick={vi.fn()}
          programs={samplePrograms}
          groups={sampleGroups}
        />,
      )
      expect(screen.getByText('Lab A2')).toBeInTheDocument()
      expect(screen.getByText('Seminar B')).toBeInTheDocument()
    })

    it('renders inherited group chips when the restriction comes from an ancestor', () => {
      render(
        <CategoryTile
          category={makeCategory()}
          onClick={vi.fn()}
          programs={samplePrograms}
          groups={sampleGroups}
          inheritedGroupIds={[30]}
        />,
      )

      const chip = screen.getByText('Lab A2').closest('.MuiChip-root')
      expect(chip).toBeInTheDocument()
      expect(chip).toHaveStyle({ opacity: '0.6' })
    })
  })

  // ─── Card image ───────────────────────────────────────────────────

  describe('card image', () => {
    it('renders the folder icon when no card image is set', () => {
      render(<CategoryTile category={makeCategory()} onClick={vi.fn()} programs={[]} />)
      expect(screen.getByTestId('FolderIcon')).toBeInTheDocument()
    })

    it('renders the thumbnail when cardImageId matches an image', () => {
      render(
        <CategoryTile
          category={makeCategory({
            cardImageId: 5,
            images: [
              {
                id: 5,
                name: 'Card Img',
                thumb: '/thumbs/card.jpg',
                tileSources: '',
                active: true,
                sortOrder: 0,
                version: 1,
              },
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
        <CategoryTile category={makeCategory()} onClick={vi.fn()} programs={[]} onMove={vi.fn()} />,
      )
      expect(screen.getByLabelText('Move category')).toBeInTheDocument()
    })

    it('calls onMove when the move button is clicked', async () => {
      const user = userEvent.setup()
      const category = makeCategory()
      const onMove = vi.fn()
      render(<CategoryTile category={category} onClick={vi.fn()} programs={[]} onMove={onMove} />)

      await user.click(screen.getByLabelText('Move category'))
      expect(onMove).toHaveBeenCalledWith(category)
    })

    it('does not render the move button when onMove is not provided', () => {
      render(<CategoryTile category={makeCategory()} onClick={vi.fn()} programs={[]} />)
      expect(screen.queryByLabelText('Move category')).not.toBeInTheDocument()
    })
  })

  // ─── Native file drop ──────────────────────────────────────────────

  describe('native file drop', () => {
    it('calls onDropFiles when native files are dropped', () => {
      const onDropFiles = vi.fn()
      const { container } = render(
        <CategoryTile
          category={makeCategory({ id: 8 })}
          onClick={vi.fn()}
          programs={[]}
          onDropFiles={onDropFiles}
        />,
      )
      const card = container.querySelector('.MuiCard-root')!
      const fakeFile = new File(['data'], 'photo.png', { type: 'image/png' })
      const event = new Event('drop', { bubbles: true })
      Object.assign(event, {
        dataTransfer: {
          setData: vi.fn(),
          getData: () => '',
          effectAllowed: '',
          dropEffect: '',
          types: ['Files'],
          files: [fakeFile],
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      fireEvent(card, event)
      expect(onDropFiles).toHaveBeenCalledWith(8, [fakeFile])
    })
  })

  describe('mobile (compact viewport)', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })
    afterEach(() => {
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('hides restriction chips on mobile but still shows the name and meta', () => {
      render(
        <CategoryTile
          category={makeCategory({ label: 'Pathology Cases', programIds: [10] })}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      // Name still renders…
      expect(screen.getByText('Pathology Cases')).toBeInTheDocument()
      // …but the program chip is omitted in the compact folder-card layout.
      expect(screen.queryByText('Pathology')).not.toBeInTheDocument()
    })
  })
})
