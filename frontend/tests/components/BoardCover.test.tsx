import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import BoardCover from '../../src/components/BoardCover'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../../src/components/markerFixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoard: vi.fn(),
  fetchMarker: vi.fn(),
  fetchMarkers: vi.fn(),
}))

const placeholder = (container: HTMLElement) =>
  container.querySelector('[data-testid="SpaceDashboardOutlinedIcon"]')

describe('BoardCover', () => {
  beforeEach(() => {
    vi.mocked(api.fetchMarkers).mockReset().mockResolvedValue([])
  })

  it('shows the summary cover without fetching members', () => {
    const { container } = render(
      <BoardCover board={{ ...BOARD_FIXTURE, cover_thumb: '/thumb/cover.jpg' }} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', '/thumb/cover.jpg')
    // The summary already carries the pinned/first-member thumbnail (#1978 review).
    expect(api.fetchMarkers).not.toHaveBeenCalled()
  })

  it('renders the placeholder without fetching for a Board with no Markers', () => {
    const { container } = render(<BoardCover board={{ ...BOARD_FIXTURE, marker_count: 0 }} />)
    expect(placeholder(container)).not.toBeNull()
    expect(api.fetchMarkers).not.toHaveBeenCalled()
  })

  it('drops a looked-up thumbnail once the Board has no Markers', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...MARKER_FIXTURE, id: 9, thumb: '/thumb/member.jpg' },
    ])
    const { container, rerender } = render(<BoardCover board={BOARD_FIXTURE} />)
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', '/thumb/member.jpg'),
    )
    rerender(
      <BoardCover
        board={{ ...BOARD_FIXTURE, marker_count: 0, version: BOARD_FIXTURE.version + 1 }}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(placeholder(container)).not.toBeNull()
  })

  it('falls back to the first member Marker with a thumbnail', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...MARKER_FIXTURE, id: 8, thumb: null },
      { ...MARKER_FIXTURE, id: 9, thumb: '/thumb/member.jpg' },
    ])
    const { container } = render(<BoardCover board={BOARD_FIXTURE} />)
    expect(placeholder(container)).not.toBeNull()
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', '/thumb/member.jpg'),
    )
    expect(api.fetchMarkers).toHaveBeenCalledWith({ board_id: BOARD_FIXTURE.id, limit: 4 })
  })

  it('renders the placeholder without fetching for an explicit no-cover pick', () => {
    const { container } = render(
      <BoardCover
        board={{ ...BOARD_FIXTURE, cover_blank: true, cover_thumb: '/thumb/cover.jpg' }}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(placeholder(container)).not.toBeNull()
    expect(api.fetchMarkers).not.toHaveBeenCalled()
  })

  it('keeps the placeholder when member Markers fail to load', async () => {
    vi.mocked(api.fetchMarkers).mockRejectedValue(new Error('offline'))
    const { container } = render(<BoardCover board={BOARD_FIXTURE} />)
    await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
    expect(container.querySelector('img')).toBeNull()
    expect(placeholder(container)).not.toBeNull()
  })

  it('sizes the square to the size prop', () => {
    const { container } = render(
      <BoardCover board={{ ...BOARD_FIXTURE, cover_blank: true }} size={40} />,
    )
    expect(container.firstElementChild).toHaveStyle({ width: '40px', height: '40px' })
  })
})
