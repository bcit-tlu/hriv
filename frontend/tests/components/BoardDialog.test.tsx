import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import BoardDialog from '../../src/components/BoardDialog'
import { BOARD_AUTH, BOARDS_FIXTURES, BOARD_USER } from '../../src/components/boardsFixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoard: vi.fn(),
  fetchBoards: vi.fn(),
  fetchMarker: vi.fn(),
  fetchPrograms: vi.fn(),
  fetchGroups: vi.fn(),
  updateMarker: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchBoard).mockImplementation(
    async (id) => BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0],
  )
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchMarker).mockResolvedValue(BOARDS_FIXTURES[0].markers[0])
  vi.mocked(api.fetchPrograms).mockResolvedValue([])
  vi.mocked(api.fetchGroups).mockResolvedValue([])
  vi.mocked(api.updateMarker).mockResolvedValue(BOARDS_FIXTURES[0].markers[0])
})

function setup(boardId: number | null = 1, props: Partial<Parameters<typeof BoardDialog>[0]> = {}) {
  const onOpenMarker = vi.fn()
  const onManage = vi.fn()
  const onClose = vi.fn()
  render(
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardDialog
        boardId={boardId}
        currentUser={BOARD_USER}
        onClose={onClose}
        onOpenMarker={onOpenMarker}
        onManage={onManage}
        {...props}
      />
    </AuthContext.Provider>,
  )
  return { onOpenMarker, onManage, onClose }
}

describe('BoardDialog', () => {
  it('shows the Board heading, scope, description and marker tiles', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Architecture inspiration' })
    expect(screen.getByText('(6 Markers)')).toBeInTheDocument()
    expect(
      screen.getByText('Details worth a second look — our studio inspiration board.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Board scope and owners' })).toHaveTextContent(
      'Managed by Alex',
    )
    expect(screen.getAllByRole('button', { name: /^Open Marker: / })).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Open in Boards & Markers' })).toBeInTheDocument()
  })

  it('stays closed without a Board id', () => {
    setup(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.fetchBoard).not.toHaveBeenCalled()
  })

  it('reports marker picks through onOpenMarker', async () => {
    const { onOpenMarker } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Marker: Stone columns' }))
    expect(onOpenMarker).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, title: 'Stone columns' }),
    )
  })

  it('routes the manage link to the full Boards & Markers surface', async () => {
    const { onManage } = setup(2)
    await screen.findByRole('heading', { name: 'Shared discoveries' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in Boards & Markers' }))
    expect(onManage).toHaveBeenCalledWith(2)
  })

  it('closes via the header button and hides management controls for read-only Boards', async () => {
    const { onClose } = setup(2)
    await screen.findByRole('heading', { name: 'Shared discoveries' })
    // A Board the user cannot edit hides Edit/owners affordances.
    expect(screen.queryByRole('button', { name: 'Edit Board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage owners' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Board' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the shared BoardEditDialog from the header pencil', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Architecture inspiration' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Board' }))
    expect(await screen.findByRole('dialog', { name: 'Edit Board' })).toBeInTheDocument()
  })

  it('opens the shared MarkerFormDialog from a marker pencil', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Architecture inspiration' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Marker: Rose window' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(api.fetchBoards).toHaveBeenCalled())
  })

  it('toggles a marker favourite and reloads the Board', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Architecture inspiration' })
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Stone columns' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(8, { version: 3, favourite: true }),
    )
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(2))
  })

  it('surfaces load failures with a reload action', async () => {
    vi.mocked(api.fetchBoard).mockRejectedValue(new Error('offline'))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load Board.')
    vi.mocked(api.fetchBoard).mockImplementation(
      async (id) => BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await screen.findByRole('heading', { name: 'Architecture inspiration' })
  })

  it('renders an empty Board without markers', async () => {
    setup(3)
    await screen.findByRole('heading', { name: 'Next studio project' })
    expect(screen.getByText('No Markers yet. Save a view from an image.')).toBeInTheDocument()
    expect(screen.getByText('(0 Markers)')).toBeInTheDocument()
  })
})
