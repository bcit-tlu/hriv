import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import BoardsPage from '../../src/components/BoardsPage'
import {
  BOARD_AUTH,
  BOARDS_FIXTURES,
  BOARD_ITEMS,
  BOARD_USER,
} from '../../src/components/boardsFixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoards: vi.fn(),
  fetchBoard: vi.fn(),
  fetchInuksuks: vi.fn(),
  fetchInuksuk: vi.fn(),
  updateInuksuk: vi.fn(),
  deleteBoard: vi.fn(),
  createBoardSection: vi.fn(),
  updateBoardSection: vi.fn(),
  deleteBoardSection: vi.fn(),
  reorderBoardInuksuks: vi.fn(),
  removeBoardInuksuk: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchBoard).mockImplementation(
    async (id) => BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0],
  )
  vi.mocked(api.fetchInuksuks).mockResolvedValue(BOARD_ITEMS)
  vi.mocked(api.fetchInuksuk).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.updateInuksuk).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.deleteBoard).mockResolvedValue()
  vi.mocked(api.createBoardSection).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.updateBoardSection).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.deleteBoardSection).mockResolvedValue()
  vi.mocked(api.reorderBoardInuksuks).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.removeBoardInuksuk).mockResolvedValue(BOARDS_FIXTURES[0])
})
async function setup(
  boardId: number | null = null,
  props: Partial<React.ComponentProps<typeof BoardsPage>> = {},
) {
  const onSelectBoard = vi.fn(),
    onOpenInuksuk = vi.fn()
  const view = render(
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardsPage
        enabled
        currentUser={BOARD_USER}
        boardId={boardId}
        onSelectBoard={onSelectBoard}
        onOpenInuksuk={onOpenInuksuk}
        {...props}
      />
    </AuthContext.Provider>,
  )
  if (props.enabled !== false)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  return { ...view, onSelectBoard, onOpenInuksuk, user: userEvent.setup() }
}
async function actions() {
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rose window' }))
}
describe('BoardsPage', () => {
  it('names Board save targets and Section move targets', async () => {
    await setup(1)
    expect(screen.getByRole('region', { name: 'Save to Architecture inspiration' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Move to section Windows' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Move to section Unsectioned' })).toBeVisible()
  })
  it.each(['student', 'staff'] as const)(
    'keeps read-only program-owned Boards visible but not draggable for %s',
    async (role) => {
      const readOnly = {
        ...BOARDS_FIXTURES[1],
        owners: [],
        owner_program_id: 1,
        permissions: { ...BOARDS_FIXTURES[1].permissions, can_edit: false },
      }
      vi.mocked(api.fetchBoards).mockResolvedValue([BOARDS_FIXTURES[0], readOnly])
      await setup(null, { currentUser: { ...BOARD_USER, role } })
      expect(screen.getByRole('button', { name: `Open Board: ${readOnly.name}` })).toBeVisible()
      expect(
        screen.queryByRole('button', { name: `Reorder ${readOnly.name}` }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: `Reorder ${BOARDS_FIXTURES[0].name}` }),
      ).toBeVisible()
    },
  )
  it('renews an Inuksuk thumbnail via its own endpoint, not the image id', async () => {
    vi.mocked(api.fetchInuksuk).mockResolvedValue({ ...BOARD_ITEMS[0], thumb: '/renewed.jpg' })
    await setup()
    const card = screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })
    const image = card.querySelector('img')
    expect(image).not.toBeNull()
    if (image) {
      fireEvent.error(image)
      await waitFor(() => expect(image).toHaveAttribute('src', '/renewed.jpg'))
    }
    expect(api.fetchInuksuk).toHaveBeenCalledWith(7)
  })
  it('makes no requests and renders nothing with the flag off', async () => {
    const view = await setup(null, { enabled: false })
    expect(view.container).toBeEmptyDOMElement()
    expect(api.fetchBoards).not.toHaveBeenCalled()
  })
  it('shows owned Boards first, a New Board card and recent Inuksuks', async () => {
    const view = await setup()
    expect(
      screen.getByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' }))
    expect(view.onOpenInuksuk).toHaveBeenCalledWith(BOARD_ITEMS[0])
    fireEvent.click(screen.getByRole('button', { name: 'New Board' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('New Board')
  })
  it('opens a Board and switches to Shared/Public without drag handles', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Open Board: Architecture inspiration' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Shared with me / Public' }))
    expect(screen.getByRole('button', { name: 'Open Board: Shared discoveries' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Reorder Shared discoveries' }),
    ).not.toBeInTheDocument()
  })
  it('filters favourites on the server and toggles them with the Inuksuk version', async () => {
    await setup()
    fireEvent.click(screen.getByRole('switch', { name: 'Favourites only' }))
    await waitFor(() =>
      expect(api.fetchInuksuks).toHaveBeenCalledWith(expect.objectContaining({ favourite: true })),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, { version: 3, favourite: false }),
    )
  })
  it('groups a selected Board into named Sections and Unsectioned', async () => {
    const view = await setup(1)
    expect(
      within(screen.getByRole('region', { name: 'Windows' })).getByText('Rose window'),
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'Unsectioned' })).getByText('Light through glass'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Windows' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(1, 11)
  })
  it('honours the Section URL selection and can clear a stale selection', async () => {
    const view = await setup(1, { sectionId: 99 })
    expect(screen.getByText(/Section no longer exists/)).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Windows' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All Sections' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(1)
  })
  it('hides management actions without permissions', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[2])
    await setup(2)
    expect(screen.queryByRole('button', { name: 'Edit Board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Owners' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Section' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
  })
  it('creates and renames Sections using Board OCC', async () => {
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'New Section' }))
    fireEvent.change(screen.getByLabelText(/Section name/), { target: { value: 'New details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(api.createBoardSection).toHaveBeenCalledWith(1, { name: 'New details', version: 5 }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Windows' })).getByRole('button', {
        name: 'Rename',
      }),
    )
    fireEvent.change(screen.getByLabelText(/Section name/), { target: { value: 'Glazing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(api.updateBoardSection).toHaveBeenCalledWith(1, 11, { name: 'Glazing', version: 5 }),
    )
  })
  it('warns before deleting a Section and returns its items to Unsectioned', async () => {
    await setup(1)
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Windows' })).getByRole('button', {
        name: 'Delete Section',
      }),
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('will become Unsectioned')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.deleteBoardSection).toHaveBeenCalledWith(1, 11, 5))
  })
  it('offers a keyboard-accessible move between Sections with the full membership list', async () => {
    await setup(1)
    await actions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Unsectioned' }))
    await waitFor(() => expect(api.reorderBoardInuksuks).toHaveBeenCalled())
    const body = vi.mocked(api.reorderBoardInuksuks).mock.calls[0][1]
    expect(body.version).toBe(5)
    expect(body.items).toHaveLength(6)
    expect(body.items.at(-1)).toEqual({ inuksuk_id: 7, section_id: null })
  })
  it('preserves editable links, Sections and positions when saving to another Board', async () => {
    const extra = {
      ...BOARDS_FIXTURES[0],
      id: 4,
      inuksuks: [{ ...BOARDS_FIXTURES[0].inuksuks[0], section_id: 99, sort_order: 17 }],
    }
    vi.mocked(api.fetchInuksuk).mockResolvedValue({ ...BOARD_ITEMS[0], board_ids: [1, 4, 2] })
    vi.mocked(api.fetchBoard).mockImplementation(async (id) =>
      id === 4 ? extra : (BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0]),
    )
    await setup(1)
    await actions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move/Save to…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [
          { board_id: 1, section_id: 11, sort_order: 0 },
          { board_id: 4, section_id: 99, sort_order: 17 },
          { board_id: 3, section_id: null },
        ],
      }),
    )
  })
  it('moves across Boards atomically when explicitly requested', async () => {
    await setup(1)
    await actions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move/Save to…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('switch', { name: 'Move: also remove from this Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [{ board_id: 3, section_id: null }],
      }),
    )
  })
  it('never submits a destructive partial assignment list after a membership read fails', async () => {
    vi.mocked(api.fetchInuksuk).mockResolvedValue({ ...BOARD_ITEMS[0], board_ids: [1, 4] })
    vi.mocked(api.fetchBoard).mockImplementation(async (id) => {
      if (id === 4) throw new Error('offline')
      return BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0]
    })
    await setup(1)
    await actions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move/Save to…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeInTheDocument(),
    )
    expect(api.updateInuksuk).not.toHaveBeenCalled()
  })
  it('surfaces the last-Board removal error instead of deleting the Inuksuk', async () => {
    vi.mocked(api.removeBoardInuksuk).mockRejectedValue(
      new api.ApiError(422, 'An Inuksuk must belong to at least one Board'),
    )
    await setup(1)
    await actions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from this Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        'at least one Board',
      ),
    )
    expect(api.removeBoardInuksuk).toHaveBeenCalledWith(1, 7, 5)
  })
  it('warns about orphan deletion before deleting a Board', async () => {
    const view = await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Board' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Inuksuks only on this Board will be permanently deleted')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Board' }))
    await waitFor(() => expect(view.onSelectBoard).toHaveBeenCalledWith(null))
    expect(api.deleteBoard).toHaveBeenCalledWith(1, 5)
  })
  it('surfaces OCC conflicts with an explicit reload and no optimistic mutation', async () => {
    vi.mocked(api.updateInuksuk).mockRejectedValueOnce(new api.ApiError(409, 'stale'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    await screen.findByText(/Reload the latest version/)
    expect(screen.getByRole('button', { name: 'Favourite Rose window' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Favourite Rose window' })).toBeEnabled(),
    )
  })
  it('renders an empty overview', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([])
    vi.mocked(api.fetchInuksuks).mockResolvedValue([])
    await setup()
    expect(screen.getByText(/No Inuksuks yet/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Board' })).toBeVisible()
  })
  it('keeps navigation available when the selected Board cannot be read', async () => {
    vi.mocked(api.fetchBoard).mockRejectedValue(new api.ApiError(404, 'Board not found'))
    const view = await setup(999)
    expect(screen.getByRole('alert')).toHaveTextContent('Board not found')
    fireEvent.click(screen.getByRole('button', { name: 'All Inuksuks' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(null)
  })
})
