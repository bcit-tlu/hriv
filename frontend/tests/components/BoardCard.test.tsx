import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import BoardCard from '../../src/components/BoardCard'
import { BOARD_FIXTURE } from '../../src/components/markerFixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoard: vi.fn(),
  fetchMarker: vi.fn(),
  fetchMarkers: vi.fn(),
}))

describe('BoardCard (#1978)', () => {
  beforeEach(() => {
    vi.mocked(api.fetchMarkers).mockReset().mockResolvedValue([])
  })

  it('shows the name, Marker count and scope chip, and opens on click', async () => {
    const onOpen = vi.fn()
    const board = { ...BOARD_FIXTURE, name: 'Histology week 3', marker_count: 12 }
    render(<BoardCard board={board} onOpen={onOpen} />)

    expect(screen.getByRole('heading', { name: 'Histology week 3' })).toBeInTheDocument()
    expect(screen.getByText('12 Markers')).toBeInTheDocument()
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent('Private')

    fireEvent.click(screen.getByRole('button', { name: 'Open Board: Histology week 3' }))
    expect(onOpen).toHaveBeenCalledWith(board)
    await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
  })

  it('uses the singular for one Marker', async () => {
    render(<BoardCard board={{ ...BOARD_FIXTURE, marker_count: 1 }} onOpen={vi.fn()} />)
    expect(screen.getByText('1 Marker')).toBeInTheDocument()
    await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
  })

  it('shows the summary cover full width without fetching members', () => {
    const { container } = render(
      <BoardCard board={{ ...BOARD_FIXTURE, cover_thumb: '/thumb/cover.jpg' }} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', '/thumb/cover.jpg')
    expect(api.fetchMarkers).not.toHaveBeenCalled()
  })

  it('falls back to the filled Boards icon on a brand cover when there is no cover', () => {
    const { container } = render(
      <BoardCard board={{ ...BOARD_FIXTURE, cover_blank: true }} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-testid="SpaceDashboardIcon"]')).not.toBeNull()
    // The outlined icon sits beside the title, like CategoryTile's folder.
    expect(container.querySelector('[data-testid="SpaceDashboardOutlinedIcon"]')).not.toBeNull()
  })

  it.each([
    ['public', 'Public'],
    ['restricted', 'Restricted'],
  ] as const)('shows the %s scope chip', async (visibility, label) => {
    render(<BoardCard board={{ ...BOARD_FIXTURE, visibility }} onOpen={vi.fn()} />)
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent(label)
    await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
  })

  it('renders a cover action outside the open-Board button, at the chosen heading level', async () => {
    const onOpen = vi.fn()
    const onCover = vi.fn()
    render(
      <BoardCard
        board={BOARD_FIXTURE}
        onOpen={onOpen}
        titleHeadingLevel="h2"
        coverAction={<button onClick={onCover}>Set cover</button>}
      />,
    )
    const open = screen.getByRole('button', { name: `Open Board: ${BOARD_FIXTURE.name}` })
    const cover = screen.getByRole('button', { name: 'Set cover' })
    // Not nested inside the action area: no interactive-in-interactive.
    expect(open).not.toContainElement(cover)
    fireEvent.click(cover)
    expect(onCover).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 2, name: BOARD_FIXTURE.name })).toBeInTheDocument()
    await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
  })
})
