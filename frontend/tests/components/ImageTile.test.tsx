/**
 * Unit tests for the ImageTile component.
 *
 * Covers:
 * 1. Basic rendering — image name, thumbnail, and card structure
 * 2. Inactive indicator — greyscale card and VisibilityOff icon when active=false
 * 3. Active images — no inactive indicator when active=true
 * 4. Copyright text — renders copyright when present
 * 5. Edit details button — renders and calls callback
 * 6. Visibility toggle — renders toggle button, calls callback, correct icon states
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const apiMocks = vi.hoisted(() => ({
  fetchImage: vi.fn(),
}))

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchImage: apiMocks.fetchImage,
  }
})

import ImageTile from '../../src/components/ImageTile'
import { makeImage } from '../helpers/fixtures'
import { resetTileTokenRenewalCacheForTests } from '../../src/tileTokenRenewal'

const expectEffectiveOpacity = (element: Element | null, opacity: string) => {
  expect(element).toBeInTheDocument()
  expect(window.getComputedStyle(element as Element).opacity || '1').toBe(opacity)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageTile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTileTokenRenewalCacheForTests()
  })

  // ─── Basic rendering ──────────────────────────────────────────────

  describe('basic rendering', () => {
    it('renders the image name', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} />)
      expect(screen.getByText('Test Image')).toBeInTheDocument()
    })

    it('renders the thumbnail image', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} />)
      const img = screen.getByAltText('Test Image')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', '/thumbs/test.jpg')
    })

    it('renews an expired thumbnail URL once when the image fails to load', async () => {
      apiMocks.fetchImage.mockResolvedValue({
        id: 100,
        name: 'Test Image',
        thumb: '/thumbs/test.jpg?tile_token=fresh',
        tile_sources: '/tiles/test.dzi?tile_token=fresh',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 2,
        width: null,
        height: null,
        file_size: null,
        created_at: '',
        updated_at: '',
      })
      const onImageRenewed = vi.fn()
      render(<ImageTile image={makeImage()} onClick={vi.fn()} onImageRenewed={onImageRenewed} />)
      const img = screen.getByAltText('Test Image')

      fireEvent.error(img)

      await waitFor(() => expect(img).toHaveAttribute('src', '/thumbs/test.jpg?tile_token=fresh'))
      expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1)
      expect(apiMocks.fetchImage).toHaveBeenCalledWith(100)
      expect(onImageRenewed).toHaveBeenCalledWith(
        expect.objectContaining({ thumb: '/thumbs/test.jpg?tile_token=fresh' }),
      )

      fireEvent.error(img)
      expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1)
    })

    it('calls onClick when the card is clicked', async () => {
      const user = userEvent.setup()
      const image = makeImage()
      const onClick = vi.fn()
      render(<ImageTile image={image} onClick={onClick} />)

      await user.click(screen.getByText('Test Image'))
      expect(onClick).toHaveBeenCalledWith(image)
    })
  })

  // ─── Inactive indicator ───────────────────────────────────────────

  describe('inactive indicator', () => {
    it('shows the inactive icon with tooltip when image is inactive', () => {
      render(<ImageTile image={makeImage({ active: false })} onClick={vi.fn()} />)
      expect(screen.getByTestId('VisibilityOffIcon')).toBeInTheDocument()
    })

    it('renders the card in greyscale when image is inactive', () => {
      render(
        <ImageTile
          image={makeImage({ active: false, name: 'Inactive Slide' })}
          onClick={vi.fn()}
        />,
      )
      const title = screen.getByText('Inactive Slide')
      expect(title.closest('[data-testid="image-tile-action-area"]')).toHaveStyle({
        filter: 'grayscale(100%)',
      })
    })

    it('does not show the inactive icon when image is active', () => {
      render(<ImageTile image={makeImage({ active: true })} onClick={vi.fn()} />)
      expect(screen.queryByTestId('VisibilityOffIcon')).not.toBeInTheDocument()
    })

    it('does not apply greyscale when image is active', () => {
      render(
        <ImageTile image={makeImage({ active: true, name: 'Active Slide' })} onClick={vi.fn()} />,
      )
      const title = screen.getByText('Active Slide')
      expect(title.closest('[data-testid="image-tile-action-area"]')).toHaveStyle({
        filter: 'none',
      })
    })

    it('shows the full image name in a hover tooltip', async () => {
      const user = userEvent.setup()
      render(
        <ImageTile
          image={makeImage({
            name: 'Tooltip Image',
          })}
          onClick={vi.fn()}
        />,
      )

      await user.hover(screen.getByText('Tooltip Image'))
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Tooltip Image')
    })

    it('clamps the title to three lines and aligns the title row to the top', () => {
      render(
        <ImageTile
          image={makeImage({
            name: 'A very long image title that should wrap across multiple lines',
          })}
          onClick={vi.fn()}
        />,
      )

      const title = screen.getByText(
        'A very long image title that should wrap across multiple lines',
      )
      const titleRow = title.closest('[data-testid="image-tile-title-row"]')

      expect(title).toHaveStyle({
        display: '-webkit-box',
        WebkitLineClamp: '3',
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        wordBreak: 'break-word',
      })
      expect(titleRow).toHaveStyle({ alignItems: 'flex-start' })
    })

    it('keeps category-hidden images at full opacity while greyscaling the tile', () => {
      render(
        <ImageTile
          image={makeImage({ active: true, name: 'Inherited Hidden Image' })}
          onClick={vi.fn()}
          categoryHidden
        />,
      )
      const title = screen.getByText('Inherited Hidden Image')
      const card = title.closest('[data-testid="image-tile"]')
      const actionArea = title.closest('[data-testid="image-tile-action-area"]')

      expectEffectiveOpacity(card, '1')
      expect(actionArea).toHaveStyle({ filter: 'grayscale(100%)' })
    })
  })

  // ─── Copyright ────────────────────────────────────────────────────

  describe('copyright', () => {
    it('renders copyright text when present', () => {
      render(<ImageTile image={makeImage({ copyright: 'BCIT 2024' })} onClick={vi.fn()} />)
      expect(screen.getByText(/BCIT 2024/)).toBeInTheDocument()
    })

    it('does not render copyright when not provided', () => {
      render(<ImageTile image={makeImage({ copyright: null })} onClick={vi.fn()} />)
      expect(screen.queryByText(/©/)).not.toBeInTheDocument()
    })
  })

  // ─── Edit details button ──────────────────────────────────────────

  describe('edit details button', () => {
    it('renders the edit button when onEditDetails is provided', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} onEditDetails={vi.fn()} />)
      expect(screen.getByLabelText('Edit image details')).toBeInTheDocument()
      expect(screen.getByTestId('EditIcon')).toBeInTheDocument()
    })

    it('calls onEditDetails when the edit button is clicked', async () => {
      const user = userEvent.setup()
      const image = makeImage()
      const onEditDetails = vi.fn()
      render(<ImageTile image={image} onClick={vi.fn()} onEditDetails={onEditDetails} />)

      await user.click(screen.getByLabelText('Edit image details'))
      expect(onEditDetails).toHaveBeenCalledWith(image)
    })

    it('does not render the edit button when onEditDetails is not provided', () => {
      render(<ImageTile image={makeImage()} onClick={vi.fn()} />)
      expect(screen.queryByLabelText('Edit image details')).not.toBeInTheDocument()
    })
  })
})
