/**
 * Unit tests for the ImageTile component.
 *
 * Covers:
 * 1. Basic rendering — image name, thumbnail, and card structure
 * 2. Inactive indicator — dimmed title and DisabledVisible icon when active=false
 * 3. Active images — no inactive indicator when active=true
 * 4. Program chips — renders program labels
 * 5. Copyright text — renders copyright when present
 * 6. Edit details button — renders and calls callback
 * 7. Visibility toggle — renders toggle button, calls callback, correct icon states
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageTile from '../../src/components/ImageTile'
import type { ImageItem, Program } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 1,
    name: 'Test Image',
    thumb: '/thumbs/test.jpg',
    tileSources: '/tiles/test.dzi',
    programIds: [],
    active: true,
    version: 1,
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

describe('ImageTile', () => {
  // ─── Basic rendering ──────────────────────────────────────────────

  describe('basic rendering', () => {
    it('renders the image name', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} programs={[]} />)
      expect(screen.getByText('Test Image')).toBeInTheDocument()
    })

    it('renders the thumbnail image', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} programs={[]} />)
      const img = screen.getByAltText('Test Image')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', '/thumbs/test.jpg')
    })

    it('calls onClick when the card is clicked', async () => {
      const user = userEvent.setup()
      const image = makeImage()
      const onClick = vi.fn()
      render(<ImageTile image={image} onClick={onClick} programs={[]} />)

      await user.click(screen.getByText('Test Image'))
      expect(onClick).toHaveBeenCalledWith(image)
    })
  })

  // ─── Inactive indicator ───────────────────────────────────────────

  describe('inactive indicator', () => {
    it('shows the inactive icon with tooltip when image is inactive', () => {
      render(
        <ImageTile
          image={makeImage({ active: false })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByTestId('DisabledVisibleIcon')).toBeInTheDocument()
    })

    it('dims the title text when image is inactive', () => {
      render(
        <ImageTile
          image={makeImage({ active: false, name: 'Inactive Slide' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Inactive Slide')
      expect(title).toHaveStyle({ opacity: 0.5 })
    })

    it('does not show the inactive icon when image is active', () => {
      render(
        <ImageTile
          image={makeImage({ active: true })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.queryByTestId('DisabledVisibleIcon')).not.toBeInTheDocument()
    })

    it('title has full opacity when image is active', () => {
      render(
        <ImageTile
          image={makeImage({ active: true, name: 'Active Slide' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      const title = screen.getByText('Active Slide')
      expect(title).toHaveStyle({ opacity: 1 })
    })
  })

  // ─── Program chips ────────────────────────────────────────────────

  describe('program chips', () => {
    it('renders program chips for matching program IDs', () => {
      render(
        <ImageTile
          image={makeImage({ programIds: [10, 20] })}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      expect(screen.getByText('Pathology')).toBeInTheDocument()
      expect(screen.getByText('Radiology')).toBeInTheDocument()
    })

    it('does not render program chips when programIds is empty', () => {
      render(
        <ImageTile
          image={makeImage({ programIds: [] })}
          onClick={vi.fn()}
          programs={samplePrograms}
        />,
      )
      expect(screen.queryByText('Pathology')).not.toBeInTheDocument()
      expect(screen.queryByText('Radiology')).not.toBeInTheDocument()
    })
  })

  // ─── Copyright ────────────────────────────────────────────────────

  describe('copyright', () => {
    it('renders copyright text when present', () => {
      render(
        <ImageTile
          image={makeImage({ copyright: 'BCIT 2024' })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.getByText(/BCIT 2024/)).toBeInTheDocument()
    })

    it('does not render copyright when not provided', () => {
      render(
        <ImageTile
          image={makeImage({ copyright: null })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.queryByText(/©/)).not.toBeInTheDocument()
    })
  })

  // ─── Edit details button ──────────────────────────────────────────

  describe('edit details button', () => {
    it('renders the edit button when onEditDetails is provided', () => {
      render(
        <ImageTile
          image={makeImage()}
          onClick={vi.fn()}
          programs={[]}
          onEditDetails={vi.fn()}
        />,
      )
      expect(screen.getByTestId('MoreVertIcon')).toBeInTheDocument()
    })

    it('calls onEditDetails when the edit button is clicked', async () => {
      const user = userEvent.setup()
      const image = makeImage()
      const onEditDetails = vi.fn()
      render(
        <ImageTile
          image={image}
          onClick={vi.fn()}
          programs={[]}
          onEditDetails={onEditDetails}
        />,
      )

      await user.click(screen.getByTestId('MoreVertIcon'))
      expect(onEditDetails).toHaveBeenCalledWith(image)
    })

    it('does not render the edit button when onEditDetails is not provided', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} programs={[]} />)
      expect(screen.queryByTestId('MoreVertIcon')).not.toBeInTheDocument()
    })
  })

  // ─── Visibility toggle ────────────────────────────────────────────

  describe('visibility toggle', () => {
    it('renders the VisibilityIcon when image is active and toggle provided', () => {
      render(
        <ImageTile
          image={makeImage({ active: true })}
          onClick={vi.fn()}
          programs={[]}
          onToggleVisibility={vi.fn()}
        />,
      )
      expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument()
      expect(screen.queryByTestId('DisabledVisibleIcon')).not.toBeInTheDocument()
    })

    it('renders the DisabledVisibleIcon when image is inactive and toggle provided', () => {
      render(
        <ImageTile
          image={makeImage({ active: false })}
          onClick={vi.fn()}
          programs={[]}
          onToggleVisibility={vi.fn()}
        />,
      )
      expect(screen.getByTestId('DisabledVisibleIcon')).toBeInTheDocument()
      expect(screen.queryByTestId('VisibilityIcon')).not.toBeInTheDocument()
    })

    it('calls onToggleVisibility with (id, hidden=true) when hiding an active image', async () => {
      const user = userEvent.setup()
      const onToggle = vi.fn()
      render(
        <ImageTile
          image={makeImage({ id: 42, active: true })}
          onClick={vi.fn()}
          programs={[]}
          onToggleVisibility={onToggle}
        />,
      )

      await user.click(screen.getByLabelText('Toggle visibility'))
      expect(onToggle).toHaveBeenCalledWith(42, true)
    })

    it('calls onToggleVisibility with (id, hidden=false) when showing an inactive image', async () => {
      const user = userEvent.setup()
      const onToggle = vi.fn()
      render(
        <ImageTile
          image={makeImage({ id: 7, active: false })}
          onClick={vi.fn()}
          programs={[]}
          onToggleVisibility={onToggle}
        />,
      )

      await user.click(screen.getByLabelText('Toggle visibility'))
      expect(onToggle).toHaveBeenCalledWith(7, false)
    })

    it('does not render the toggle button when onToggleVisibility is not provided', () => {
      render(
        <ImageTile
          image={makeImage({ active: false })}
          onClick={vi.fn()}
          programs={[]}
        />,
      )
      expect(screen.queryByLabelText('Toggle visibility')).not.toBeInTheDocument()
    })

    it('suppresses inline DisabledVisibleIcon when toggle is provided', () => {
      render(
        <ImageTile
          image={makeImage({ active: false })}
          onClick={vi.fn()}
          programs={[]}
          onToggleVisibility={vi.fn()}
        />,
      )
      // Only one DisabledVisibleIcon (in the toggle button), not the inline one next to title
      const icons = screen.getAllByTestId('DisabledVisibleIcon')
      expect(icons).toHaveLength(1)
    })
  })
})
