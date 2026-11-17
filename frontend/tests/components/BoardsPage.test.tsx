import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeApiCollection, makeCategory } from '../helpers/fixtures'
import type { DragEndEvent, DragDropProvider } from '@dnd-kit/react'
import * as api from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import BoardsPage from '../../src/components/BoardsPage'
import {
  BOARD_AUTH,
  BOARDS_FIXTURES,
  BOARD_ITEMS,
  BOARD_USER,
} from '../../src/components/boardsFixtures'

const drag = vi.hoisted(() => ({ end: null as ((event: DragEndEvent) => void) | null }))
vi.mock('@dnd-kit/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/react')>()
  return {
    ...actual,
    DragDropProvider: (props: React.ComponentProps<typeof DragDropProvider>) => {
      drag.end = props.onDragEnd as (event: DragEndEvent) => void
      return <actual.DragDropProvider {...props} />
    },
  }
})

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoards: vi.fn(),
  fetchCollections: vi.fn(),
  createCollection: vi.fn(),
  createBoard: vi.fn(),
  fetchBoard: vi.fn(),
  fetchInuksuks: vi.fn(),
  fetchInuksuk: vi.fn(),
  updateInuksuk: vi.fn(),
  deleteBoard: vi.fn(),
  reorderBoardInuksuks: vi.fn(),
  removeBoardInuksuk: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchCollections).mockResolvedValue([])
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchBoard).mockImplementation(
    async (id) => BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0],
  )
  vi.mocked(api.fetchInuksuks).mockResolvedValue(BOARD_ITEMS)
  vi.mocked(api.fetchInuksuk).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.updateInuksuk).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.deleteBoard).mockResolvedValue()
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
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Inuksuk: Rose window' }))
}
function dropOnBoard(boardId: number) {
  drag.end?.({
    canceled: false,
    operation: {
      source: { id: 'item:7', type: 'board-member' },
      target: { id: `save:${boardId}` },
    },
  } as unknown as DragEndEvent)
}
describe('BoardsPage', () => {
  it('keeps outlined Select on the filter row in Cards and Table views', async () => {
    await setup()
    const filters = screen.getByRole('region', { name: 'Filter Boards and Inuksuks' })
    const select = within(filters).getByRole('button', { name: 'Select' })
    expect(select).toHaveClass('MuiButton-outlined')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    fireEvent.click(select)
    expect(within(filters).getByRole('button', { name: 'Cancel selection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(BOARD_ITEMS.length)
    fireEvent.click(within(filters).getByRole('button', { name: 'Cancel selection' }))
    expect(screen.queryByRole('checkbox', { name: /^Select / })).not.toBeInTheDocument()
  })
  it('sorts overview Cards and Table case-insensitively by title, then ID', async () => {
    vi.mocked(api.fetchInuksuks).mockResolvedValue([
      { ...BOARD_ITEMS[0], title: 'zebra' },
      { ...BOARD_ITEMS[2], title: 'Alpha' },
      { ...BOARD_ITEMS[1], title: 'alpha' },
    ])
    await setup()
    expect(
      screen
        .getAllByRole('button', { name: /^Open Inuksuk:/ })
        .map((el) => el.getAttribute('aria-label')?.replace('Open Inuksuk: ', '')),
    ).toEqual(['alpha', 'Alpha', 'zebra'])
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(
      within(screen.getByRole('table', { name: 'Inuksuks' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent),
    ).toEqual(['alpha', 'Alpha', 'zebra'])
  })
  it('sorts across all overview pages, not just within each page', async () => {
    vi.mocked(api.fetchInuksuks).mockImplementation(async (params) => {
      if (params?.board_id) return []
      return params?.page === 1
        ? Array.from({ length: 200 }, (_, i) => ({
            ...BOARD_ITEMS[0],
            id: i + 100,
            title: `Zebra ${i}`,
          }))
        : [{ ...BOARD_ITEMS[1], title: 'Alpha from page two' }]
    })
    await setup()
    const cards = screen.getAllByRole('button', { name: /^Open Inuksuk:/ })
    expect(cards).toHaveLength(201)
    expect(cards[0]).toHaveAccessibleName('Open Inuksuk: Alpha from page two')
  })
  it('keeps alphabetical order after favourite and membership updates', async () => {
    await setup()
    const titles = () =>
      screen
        .getAllByRole('button', { name: /^Open Inuksuk:/ })
        .map((el) => el.getAttribute('aria-label'))
    const initial = titles()
    vi.mocked(api.fetchInuksuks).mockResolvedValue(
      [...BOARD_ITEMS]
        .reverse()
        .map((item) => ({ ...item, favourite: true, updated_at: '2026-02-01T00:00:00Z' })),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Stone columns' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Favourite Stone columns' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(titles()).toEqual(initial)
    expect(
      within(screen.getByRole('button', { name: 'Favourite Stone columns' })).getByTestId(
        'StarIcon',
      ),
    ).toHaveClass('MuiSvgIcon-colorPrimary')
    dropOnBoard(3)
    await screen.findByText('Saved to Next studio project')
    expect(titles()).toEqual(initial)
  })
  it('places a renamed Inuksuk at its new alphabetical position', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Inuksuk: Rose window' }))
    const title = await screen.findByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'A new first view' } })
    vi.mocked(api.fetchInuksuks).mockResolvedValue(
      BOARD_ITEMS.map((item) => (item.id === 7 ? { ...item, title: 'A new first view' } : item)),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('button', { name: 'Open Inuksuk: A new first view' })
    expect(screen.getAllByRole('button', { name: /^Open Inuksuk:/ })[0]).toHaveAccessibleName(
      'Open Inuksuk: A new first view',
    )
  })
  it('uses a Board chip surface without a grip and still opens on click', async () => {
    const { onSelectBoard } = await setup()
    const chip = screen.getByRole('group', { name: 'Architecture inspiration' })
    expect(within(chip).queryByTestId('DragIndicatorIcon')).not.toBeInTheDocument()
    fireEvent.click(
      within(chip).getByRole('button', { name: 'Open Board: Architecture inspiration' }),
    )
    expect(onSelectBoard).toHaveBeenCalledWith(1)
  })
  it('orders discovery, chip Boards, My Inuksuks and the filter bar like Collections', async () => {
    await setup()
    const pageTitle = screen.getByRole('heading', { name: 'My Boards', level: 1 })
    const link = screen.getByRole('button', { name: 'Public & shared Boards' })
    expect(pageTitle.parentElement).toBe(link.parentElement)
    expect(pageTitle).toHaveClass('MuiTypography-h5')
    expect(pageTitle.parentElement).toHaveStyle({
      display: 'flex',
      justifyContent: 'space-between',
    })
    expect(link).toHaveClass('MuiButton-outlined')
    expect(pageTitle.parentElement?.parentElement).not.toHaveStyle({ padding: '24px' })
    const boards = screen.getByRole('region', { name: 'Boards' })
    const heading = screen.getByRole('heading', { name: 'My Inuksuks' })
    const filters = screen.getByRole('region', { name: 'Filter Boards and Inuksuks' })
    expect(link.compareDocumentPosition(boards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(boards.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Graph view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag Rose window' })).not.toBeInTheDocument()
    const card = screen
      .getByRole('button', { name: 'Open Inuksuk: Rose window' })
      .closest('[data-testid="inuksuk-card"]')!
    expect(card).not.toHaveStyle({ minHeight: '235px' })
    expect(within(card).getByTestId('collection-visibility-chip')).toHaveTextContent('Private')
    expect(within(card).getByTestId('StarIcon')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit Inuksuk: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Actions for Rose window' }),
    ).not.toBeInTheDocument()
  })
  it('offers equivalent table columns and preserves actions and filters across view changes', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = within(screen.getByRole('table', { name: 'Inuksuks' }))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Title',
      'Category',
      'Scope',
      'Boards',
      'Favourite',
      'Actions',
    ])
    const row = within(table.getByText('Rose window').closest('tr')!)
    expect(row.queryByRole('button', { name: 'Rose window' })).not.toBeInTheDocument()
    expect(row.getByText('Architectural details')).toBeVisible()
    expect(row.getByText('Private')).toBeVisible()
    fireEvent.click(row.getByRole('button', { name: 'Architecture inspiration' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(1)
    expect(view.onOpenInuksuk).not.toHaveBeenCalled()
    fireEvent.click(row.getByText('Architectural details'))
    expect(view.onOpenInuksuk).toHaveBeenCalledWith(BOARD_ITEMS[0])
    view.onOpenInuksuk.mockClear()
    fireEvent.click(row.getByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, { version: 3, favourite: false }),
    )
    expect(view.onOpenInuksuk).not.toHaveBeenCalled()
    fireEvent.click(row.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    expect(view.onOpenInuksuk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(row.getByRole('button', { name: 'Edit Inuksuk: Rose window' }))
    expect(view.onOpenInuksuk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(table.getByText('Uncategorized')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Boards and Inuksuks by title' }), {
      target: { value: 'No such view' },
    })
    expect(screen.getByText('No matching Inuksuks.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cards view' }))
    expect(screen.queryByTestId('inuksuk-card')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByTestId('inuksuk-card')).toHaveLength(BOARD_ITEMS.length)
  })
  it('opens focused table rows with Enter or Space but ignores nested controls', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const row = within(screen.getByRole('table')).getByText('Rose window').closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    row.focus()
    expect(row).toHaveFocus()
    await view.user.keyboard('{Enter} ')
    expect(view.onOpenInuksuk).toHaveBeenCalledTimes(2)
    expect(view.onOpenInuksuk).toHaveBeenLastCalledWith(BOARD_ITEMS[0])
    view.onOpenInuksuk.mockClear()
    await view.user.keyboard('{Escape}')
    for (const key of ['Enter', ' ']) {
      fireEvent.keyDown(within(row).getByRole('button', { name: 'Favourite Rose window' }), { key })
    }
    expect(view.onOpenInuksuk).not.toHaveBeenCalled()
  })
  it('keeps move, edit and delete reachable without an Inuksuk overflow menu', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Save “Rose window” to…')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Inuksuk: Rose window' }))
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeVisible()
  })
  it.each([
    ['Cards', true],
    ['Cards', false],
    ['Table', true],
    ['Table', false],
  ] as const)(
    'hides read-only favourite controls in %s with favourite=%s',
    async (view, favourite) => {
      vi.mocked(api.fetchInuksuks).mockResolvedValue([
        { ...BOARD_ITEMS[0], favourite, permissions: { can_edit: false, can_delete: false } },
      ])
      await setup()
      fireEvent.click(screen.getByRole('button', { name: `${view} view` }))
      expect(
        screen.queryByRole('button', { name: 'Favourite Rose window' }),
      ).not.toBeInTheDocument()
      const indicator = screen.queryByRole('img', { name: 'Favourite Rose window' })
      if (favourite) expect(indicator).toBeVisible()
      else expect(indicator).not.toBeInTheDocument()
      expect(api.updateInuksuk).not.toHaveBeenCalled()
    },
  )
  it('retains table rows and exposes errors when a favourite mutation fails', async () => {
    vi.mocked(api.updateInuksuk).mockRejectedValue(
      new api.ApiError(422, 'Unable to update favourite'),
    )
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update favourite')
    expect(within(screen.getByRole('table')).getByText('Rose window')).toBeVisible()
  })
  it.each(['Boards', 'Inuksuks'])(
    'shows an initial %s load error instead of the empty state and allows retry',
    async (source) => {
      const fetch = source === 'Boards' ? vi.mocked(api.fetchBoards) : vi.mocked(api.fetchInuksuks)
      fetch.mockRejectedValueOnce(new api.ApiError(422, 'Overview unavailable'))
      await setup()
      expect(screen.getByRole('alert')).toHaveTextContent('Overview unavailable')
      expect(screen.queryByText(/No Inuksuks yet/)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
      await screen.findByRole('button', { name: 'Open Inuksuk: Rose window' })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )
  it('retains the loaded collage and covers when a silent refresh fails and allows retry', async () => {
    await setup()
    const card = screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })
    const cover = screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })
    vi.mocked(api.fetchBoards).mockRejectedValueOnce(new api.ApiError(422, 'Overview unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Overview unavailable')
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBe(card)
    expect(screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })).toBe(cover)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/No Inuksuks yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBe(card)
  })
  it('keeps collage nodes mounted throughout a drag-save and silent refresh', async () => {
    const { container } = await setup()
    const card = screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })
    let removed = false
    let loading = false
    const observer = new MutationObserver((records) => {
      removed ||= records.some((record) =>
        [...record.removedNodes].some((node) => node.contains(card)),
      )
      loading ||= !!container.querySelector('[role="progressbar"]')
    })
    observer.observe(container, { childList: true, subtree: true })
    dropOnBoard(3)
    await screen.findByText('Saved to Next studio project')
    observer.disconnect()
    expect(removed).toBe(false)
    expect(loading).toBe(false)
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBe(card)
    expect(api.fetchBoards).toHaveBeenCalledTimes(2)
    expect(api.fetchInuksuks).toHaveBeenCalledTimes(4)
  })
  it('does not reload or remount the collage for Inuksuk editing, Board creation or Board navigation', async () => {
    const view = await setup()
    const card = screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })
    const cover = screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })
    await actions()
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(card.isConnected).toBe(true)
    expect(cover.isConnected).toBe(true)
    expect(api.fetchBoards).toHaveBeenCalledTimes(2) // overview and the form's Board picker
    expect(api.fetchInuksuks).toHaveBeenCalledTimes(3) // overview and two owned Board covers
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New Board' }))
    expect(card.isConnected).toBe(true)
    vi.mocked(api.createBoard).mockResolvedValue(BOARDS_FIXTURES.find((board) => board.id === 3)!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'New Board' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    await waitFor(() => expect(view.onSelectBoard).toHaveBeenCalledWith(3))
    view.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <BoardsPage
          enabled
          currentUser={BOARD_USER}
          boardId={3}
          onSelectBoard={view.onSelectBoard}
          onOpenInuksuk={view.onOpenInuksuk}
        />
      </AuthContext.Provider>,
    )
    await screen.findByRole('dialog', { name: 'Next studio project' })
    expect(card.isConnected).toBe(true)
    expect(cover.isConnected).toBe(true)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(api.fetchBoards).toHaveBeenCalledTimes(2)
    expect(api.fetchInuksuks).toHaveBeenCalledTimes(3)
  })
  it('filters both surfaces by title and restores them with Clear filters', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([
      { ...BOARDS_FIXTURES[0], name: 'Rose studies' },
      BOARDS_FIXTURES[1],
    ])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Boards and Inuksuks by title' }), {
      target: { value: 'Rose' },
    })
    expect(screen.getByRole('button', { name: 'Open Board: Rose studies' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Next studio project' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Inuksuk: Stone columns' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Stone columns' })).toBeVisible()
  })
  it('offers deduplicated Board and Inuksuk owners, including owners with no visible Board', async () => {
    const guestOwner = { user_id: 88, program_id: null, name: 'Taylor', role: 'student' as const }
    vi.mocked(api.fetchInuksuks).mockResolvedValue([
      { ...BOARD_ITEMS[0], owners: [guestOwner], board_ids: [2] },
      BOARD_ITEMS[1],
      { ...BOARD_ITEMS[2], owners: [guestOwner], board_ids: [2] },
    ])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    expect(screen.getAllByRole('menuitemradio').map((option) => option.textContent)).toEqual([
      'Anyone',
      'Mine',
      'Alex',
      'Morgan',
      'Taylor',
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Taylor' }))
    expect(screen.queryByRole('button', { name: /^Open Inuksuk:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open Board:/ })).not.toBeInTheDocument()
  })
  it('uses visible Board memberships for scope, including multiple scopes on one Inuksuk', async () => {
    vi.mocked(api.fetchInuksuks).mockResolvedValue([
      { ...BOARD_ITEMS[0], board_ids: [1, 2] },
      { ...BOARD_ITEMS[1], board_ids: [1] },
    ])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Scope' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Public' }))
    expect(
      screen.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Inuksuk: Stone columns' }),
    ).not.toBeInTheDocument()
  })
  it('shows the image category below the title, with a fallback for uncategorized images', async () => {
    vi.mocked(api.fetchInuksuks).mockResolvedValue([
      { ...BOARD_ITEMS[0], category_name: 'Architecture' },
      { ...BOARD_ITEMS[1], category_name: null },
    ])
    await setup()
    expect(screen.getByText('Architecture', { exact: true })).toBeVisible()
    expect(screen.getByText('Uncategorized')).toBeVisible()
  })
  it('opens Board details in a dialog with fixed heading controls and a close action', async () => {
    const view = await setup(1)
    const dialog = screen.getByRole('dialog', { name: 'Architecture inspiration' })
    expect(
      within(dialog.querySelector('#board-heading')!).getByText('Private', { exact: true }),
    ).toBeVisible()
    expect(within(dialog).getByText('6 Inuksuks')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Board' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(null)
  })
  it('saves an overview drag to a Board without removing existing memberships and reports success', async () => {
    await setup()
    dropOnBoard(3)
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [
          { board_id: 1, sort_order: BOARD_ITEMS[0].sort_order },
          { board_id: 3 },
        ],
      }),
    )
    expect(await screen.findByText('Saved to Next studio project')).toBeVisible()
  })
  it('ignores read-only targets and already-linked targets', async () => {
    await setup()
    dropOnBoard(2)
    dropOnBoard(1)
    expect(api.updateInuksuk).not.toHaveBeenCalled()
  })
  it('reports a failed drag-save without a success snackbar', async () => {
    vi.mocked(api.updateInuksuk).mockRejectedValue(new api.ApiError(422, 'Cannot save this view'))
    await setup()
    dropOnBoard(3)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save this view')
    expect(screen.queryByText('Saved to Next studio project')).not.toBeInTheDocument()
  })
  it('discards Board-local dialogs and late mutation reloads after navigating to another Board', async () => {
    let finish: (item: (typeof BOARD_ITEMS)[0]) => void = () => {}
    vi.mocked(api.updateInuksuk).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const view = await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() => expect(api.updateInuksuk).toHaveBeenCalled())
    view.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <BoardsPage
          enabled
          currentUser={BOARD_USER}
          boardId={3}
          onSelectBoard={view.onSelectBoard}
          onOpenInuksuk={view.onOpenInuksuk}
        />
      </AuthContext.Provider>,
    )
    await screen.findByRole('dialog', { name: 'Next studio project' })
    finish(BOARD_ITEMS[0])
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Next studio project' })).toBeVisible()
    expect(api.fetchBoard).toHaveBeenLastCalledWith(3)
  })
  it('includes read-only owned Boards in the compact row with New Board first', async () => {
    const readOnly = {
      ...BOARDS_FIXTURES[1],
      owners: [],
      owner_program_id: 1,
      permissions: { ...BOARDS_FIXTURES[1].permissions, can_edit: false },
    }
    vi.mocked(api.fetchBoards).mockResolvedValue([BOARDS_FIXTURES[0], readOnly, BOARDS_FIXTURES[2]])
    await setup(null, { currentUser: { ...BOARD_USER, role: 'student' } })
    const row = screen.getByRole('region', { name: 'Boards' })
    expect(within(row).getAllByRole('button')[0]).toHaveAccessibleName('New Board')
    expect(within(row).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(2)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Reorder ${readOnly.name}` }),
    ).not.toBeInTheDocument()
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
      expect(screen.getByRole('group', { name: BOARDS_FIXTURES[0].name })).toBeVisible()
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
  it('shows owned Boards, a New Board tab and owned saved views', async () => {
    const view = await setup()
    expect(
      screen.getByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Boards' })).toHaveClass('MuiTypography-h5')
    fireEvent.click(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' }))
    expect(view.onOpenInuksuk).toHaveBeenCalledWith(BOARD_ITEMS[0])
    fireEvent.click(screen.getByRole('button', { name: 'New Board' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('New Board')
  })
  it('lists others’ Boards in a separate dialog and opens the existing Board route', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Public & shared Boards' }))
    const dialog = screen.getByRole('dialog', { name: 'Public & shared Boards' })
    expect(
      within(dialog).queryByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Board: Shared discoveries' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Reorder Shared discoveries' }),
    ).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Board: Shared discoveries' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('shows an empty public/shared dialog and closes without navigation', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([BOARDS_FIXTURES[0]])
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Public & shared Boards' }))
    expect(screen.getByText('No public or shared Boards available.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(view.onSelectBoard).not.toHaveBeenCalled()
  })
  it('shows overview read errors rather than an empty public/shared list', async () => {
    vi.mocked(api.fetchBoards).mockRejectedValue(new api.ApiError(503, 'Unavailable'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Public & shared Boards' }))
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      'Unable to load Boards.',
    )
  })
  it('excludes non-owned Inuksuks even when their Board is owned', async () => {
    vi.mocked(api.fetchInuksuks).mockResolvedValue([
      BOARD_ITEMS[0],
      { ...BOARD_ITEMS[1], owners: BOARDS_FIXTURES[2].owners },
    ])
    await setup()
    expect(screen.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Inuksuk: Stone columns' }),
    ).not.toBeInTheDocument()
  })
  it('filters favourites on the server and toggles them with the Inuksuk version', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Favourites only' }))
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Favourites only' }), {
      key: 'Escape',
    })
    await waitFor(() =>
      expect(api.fetchInuksuks).toHaveBeenCalledWith(expect.objectContaining({ favourite: true })),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, { version: 3, favourite: false }),
    )
  })

  it('hides management actions without permissions', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[2])
    await setup(2)
    expect(screen.queryByRole('button', { name: 'Edit Board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Owners' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
  })

  it('preserves editable links and positions when saving to another Board', async () => {
    const extra = {
      ...BOARDS_FIXTURES[0],
      id: 4,
      inuksuks: [{ ...BOARDS_FIXTURES[0].inuksuks[0], sort_order: 17 }],
    }
    vi.mocked(api.fetchInuksuk).mockResolvedValue({ ...BOARD_ITEMS[0], board_ids: [1, 4, 2] })
    vi.mocked(api.fetchBoard).mockImplementation(async (id) =>
      id === 4 ? extra : (BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0]),
    )
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [
          { board_id: 1, sort_order: 0 },
          { board_id: 4, sort_order: 17 },
          { board_id: 3 },
        ],
      }),
    )
  })
  it('moves across Boards atomically when explicitly requested', async () => {
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('switch', { name: 'Move: also remove from this Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [{ board_id: 3 }],
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
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove from this Board' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this Board' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Board options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Board' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Close Board' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(null)
  })
})

it('offers Sequence for any selection and synchronized actions only for two to four', async () => {
  await setup()
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
  const toolbar = screen.getByRole('toolbar', { name: 'Selected Inuksuks' })
  expect(within(toolbar).getByRole('button', { name: 'Create Sequence Collection' })).toBeDisabled()
  const checks = screen.getAllByRole('checkbox', { name: /^Select / })
  fireEvent.click(checks[0])
  expect(within(toolbar).getByRole('button', { name: 'Create Sequence Collection' })).toBeEnabled()
  expect(
    within(toolbar).getByRole('button', { name: 'Create Synchronized Collection' }),
  ).toBeDisabled()
  fireEvent.click(checks[1])
  expect(
    within(toolbar).getByRole('button', { name: 'Create Synchronized Collection' }),
  ).toBeEnabled()
  expect(
    within(toolbar).getByRole('button', { name: 'Add to Synchronized Collection' }),
  ).toBeEnabled()
})

it('does not expose collection controls when collections are disabled', async () => {
  await setup(null, { collectionsEnabled: false })
  expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
})

it('creates a Sequence from the Board source and navigates to it', async () => {
  const open = vi.fn()
  vi.mocked(api.createCollection).mockResolvedValue(makeApiCollection({ id: 77, type: 'sequence' }))
  await setup(1, {
    onOpenCollection: open,
    categories: [makeCategory({ id: 10, label: 'Studies' })],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Board options' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Create Sequence Collection' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Collection name' }), {
    target: { value: 'Board sequence' },
  })
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Category' }))
  fireEvent.click(await screen.findByRole('option', { name: /Studies/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith(77))
  expect(api.createCollection).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'sequence', source_board_id: 1 }),
  )
  expect(vi.mocked(api.createCollection).mock.calls[0][0]).not.toHaveProperty('image_ids')
})

it('seeds selected views in displayed Board member order', async () => {
  const board = BOARDS_FIXTURES[0]
  vi.mocked(api.fetchBoard).mockResolvedValue({
    ...board,

    inuksuks: [...board.inuksuks].reverse(),
  })
  vi.mocked(api.createCollection).mockResolvedValue(makeApiCollection({ id: 77, type: 'sequence' }))
  await setup(1, { categories: [makeCategory({ id: 10, label: 'Studies' })] })
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
  const checkboxes = screen.getAllByRole('checkbox', { name: /^Select / })
  expect(checkboxes).toHaveLength(6)
  for (const checkbox of [...checkboxes].reverse()) fireEvent.click(checkbox)
  fireEvent.click(
    within(screen.getByRole('toolbar', { name: 'Selected Inuksuks' })).getByRole('button', {
      name: 'Create Sequence Collection',
    }),
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Collection name' }), {
    target: { value: 'Ordered views' },
  })
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Category' }))
  fireEvent.click(await screen.findByRole('option', { name: /Studies/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(api.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sequence', inuksuk_ids: [12, 11, 10, 9, 8, 7] }),
    ),
  )
})
