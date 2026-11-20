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
  fetchImages: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchMarker: vi.fn(),
  updateBoard: vi.fn(),
  updateMarker: vi.fn(),
  deleteBoard: vi.fn(),
  deleteMarker: vi.fn(),
  reorderBoardMarkers: vi.fn(),
  reorderBoards: vi.fn(),
  reorderMarkers: vi.fn(),
  removeBoardMarker: vi.fn(),
  fetchUsersPaged: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchCollections).mockResolvedValue([])
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchBoard).mockImplementation(
    async (id) => BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0],
  )
  vi.mocked(api.fetchImages).mockResolvedValue([
    {
      id: BOARD_ITEMS[0].image_id,
      name: 'Cathedral nave',
      thumb: '/hriv-splash2.jpg',
      tile_sources: '',
      category_id: 1,
      copyright: null,
      note: null,
      active: true,
      sort_order: 0,
      metadata_extra: null,
      version: 1,
      width: null,
      height: null,
      file_size: null,
      created_at: BOARD_ITEMS[0].created_at,
      updated_at: BOARD_ITEMS[0].updated_at,
    },
  ])
  vi.mocked(api.fetchMarkers).mockResolvedValue(BOARD_ITEMS)
  vi.mocked(api.fetchMarker).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.updateMarker).mockResolvedValue(BOARD_ITEMS[0])
  vi.mocked(api.deleteBoard).mockResolvedValue()
  vi.mocked(api.deleteMarker).mockResolvedValue()
  vi.mocked(api.reorderBoardMarkers).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.reorderBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.reorderMarkers).mockResolvedValue(BOARD_ITEMS)
  vi.mocked(api.removeBoardMarker).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.updateBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.fetchUsersPaged).mockResolvedValue({ items: [], total: 0 })
})
async function setup(
  boardId: number | null = null,
  props: Partial<React.ComponentProps<typeof BoardsPage>> = {},
) {
  const onSelectBoard = vi.fn(),
    onOpenMarker = vi.fn()
  const view = render(
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardsPage
        enabled
        currentUser={BOARD_USER}
        boardId={boardId}
        onSelectBoard={onSelectBoard}
        onOpenMarker={onOpenMarker}
        {...props}
      />
    </AuthContext.Provider>,
  )
  if (props.enabled !== false)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  return { ...view, onSelectBoard, onOpenMarker, user: userEvent.setup() }
}
async function actions() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Marker: Rose window' }))
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
  it('has no Select control on the overview filter row but checkbox cells in the table', async () => {
    await setup()
    const filters = screen.getByRole('region', { name: 'Filter Boards and Markers' })
    expect(within(filters).queryByRole('button', { name: 'Multi-select' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /^Select / })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByRole('checkbox', { name: 'Select all Markers on this page' })).toBeDefined()
    expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(
      BOARD_ITEMS.length + 1,
    )
  })
  it('keeps overview Cards and Table in the saved Marker order', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...BOARD_ITEMS[0], title: 'zebra' },
      { ...BOARD_ITEMS[2], title: 'Alpha' },
      { ...BOARD_ITEMS[1], title: 'alpha' },
    ])
    await setup()
    expect(
      screen
        .getAllByRole('button', { name: /^Open Marker:/ })
        .map((el) => el.getAttribute('aria-label')?.replace('Open Marker: ', '')),
    ).toEqual(['zebra', 'Alpha', 'alpha'])
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(
      within(screen.getByRole('table', { name: 'Markers' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[2].textContent),
    ).toEqual(['zebra', 'Alpha', 'alpha'])
  })
  it('sorts across all overview pages, not just within each page', async () => {
    vi.mocked(api.fetchMarkers).mockImplementation(async (params) => {
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
    const cards = screen.getAllByRole('button', { name: /^Open Marker:/ })
    expect(cards).toHaveLength(201)
    expect(cards[0]).toHaveAccessibleName('Open Marker: Zebra 0')
    expect(cards[200]).toHaveAccessibleName('Open Marker: Alpha from page two')
  })
  it('keeps the saved Marker order after favourite and membership updates', async () => {
    await setup()
    const titles = () =>
      screen
        .getAllByRole('button', { name: /^Open Marker:/ })
        .map((el) => el.getAttribute('aria-label'))
    const initial = titles()
    vi.mocked(api.fetchMarkers).mockResolvedValue(
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
    expect(titles()).toEqual([...initial].reverse())
    expect(
      within(screen.getByRole('button', { name: 'Favourite Stone columns' })).getByTestId(
        'StarIcon',
      ),
    ).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    dropOnBoard(3)
    await screen.findByText('Saved to Next studio project')
    expect(titles()).toEqual([...initial].reverse())
  })
  it('undoes an Add to Board with the version the save returned', async () => {
    vi.mocked(api.updateMarker).mockResolvedValueOnce({ ...BOARD_ITEMS[0], version: 9 })
    await setup()
    dropOnBoard(3)
    const notice = await screen.findByText('Saved to Next studio project')
    const saved = vi.mocked(api.updateMarker).mock.calls[0]
    expect(saved[1].board_assignments).toContainEqual({ board_id: 3 })
    fireEvent.click(
      within(notice.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: 'Undo',
      }),
    )
    await waitFor(() => expect(api.updateMarker).toHaveBeenCalledTimes(2))
    expect(api.updateMarker).toHaveBeenLastCalledWith(7, {
      version: 9,
      board_assignments: saved[1].board_assignments?.filter((row) => row.board_id !== 3),
    })
    await waitFor(() =>
      expect(screen.queryByText('Saved to Next studio project')).not.toBeInTheDocument(),
    )
  })
  it('leaves other tile actions visually unchanged while a favourite saves', async () => {
    vi.mocked(api.updateMarker).mockReturnValueOnce(new Promise(() => {}))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: `Favourite ${BOARD_ITEMS[0].title}` }))
    await waitFor(() => expect(api.updateMarker).toHaveBeenCalled())
    expect(
      screen.getByRole('button', { name: 'Set Next studio project cover image' }),
    ).toBeEnabled()
    for (const button of screen.getAllByRole('button', { name: /^Edit Marker: / }))
      expect(button).toBeEnabled()
  })
  it('keeps a concurrent destination assignment when undoing an Add to Board', async () => {
    const fresh = { ...BOARD_ITEMS[0], board_ids: [...BOARD_ITEMS[0].board_ids, 3] }
    vi.mocked(api.fetchMarker).mockResolvedValueOnce(fresh)
    vi.mocked(api.fetchBoard).mockImplementation(async (id) => {
      const board = BOARDS_FIXTURES.find((row) => row.id === id) ?? BOARDS_FIXTURES[0]
      return id === 3 ? { ...board, markers: [{ ...fresh, sort_order: 4 }] } : board
    })
    vi.mocked(api.updateMarker).mockResolvedValueOnce({ ...fresh, version: 9 })
    await setup()
    dropOnBoard(3)
    const notice = await screen.findByText('Saved to Next studio project')
    fireEvent.click(
      within(notice.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: 'Undo',
      }),
    )
    await waitFor(() => expect(api.updateMarker).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.updateMarker).mock.calls[1][1].board_assignments).toContainEqual({
      board_id: 3,
      sort_order: 4,
    })
  })
  it('keeps the overview layout unchanged while an opened Board loads', async () => {
    vi.mocked(api.fetchBoard).mockReturnValue(new Promise(() => {}))
    render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <BoardsPage
          enabled
          currentUser={BOARD_USER}
          boardId={1}
          onSelectBoard={vi.fn()}
          onOpenMarker={vi.fn()}
        />
      </AuthContext.Provider>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Architecture inspiration Board' })
    expect(await screen.findByText('(6 markers)')).toBeVisible()
    expect(within(dialog).getByRole('progressbar', { name: 'Loading Board' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'All Markers' })).not.toBeInTheDocument()
  })
  it('keeps a renamed Marker at its saved position', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Marker: Rose window' }))
    const title = await screen.findByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'A new first view' } })
    vi.mocked(api.fetchMarkers).mockResolvedValue(
      BOARD_ITEMS.map((item) => (item.id === 7 ? { ...item, title: 'A new first view' } : item)),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('button', { name: 'Open Marker: A new first view' })
    expect(screen.getAllByRole('button', { name: /^Open Marker:/ })[0]).toHaveAccessibleName(
      'Open Marker: A new first view',
    )
  })
  it('uses a Board chip surface without a grip and still opens on click', async () => {
    const { onSelectBoard } = await setup()
    const chip = screen.getByRole('group', { name: 'Architecture inspiration' })
    const row = screen.getByRole('region', { name: 'Boards' })
    const chips = within(row).getAllByRole('group')
    expect(Array.from(row.children).slice(1)).toEqual(chips)
    expect(chip).toHaveStyle({ flex: '0 0 auto', width: '260px' })
    expect(within(chip).queryByTestId('DragIndicatorIcon')).not.toBeInTheDocument()
    fireEvent.click(
      within(chip).getByRole('button', { name: 'Open Board: Architecture inspiration' }),
    )
    expect(onSelectBoard).toHaveBeenCalledWith(1)
  })
  it('orders title row, filter bar, chip Boards and Markers like Manage Images', async () => {
    await setup()
    const pageTitle = screen.getByRole('heading', { name: 'Boards and Markers', level: 1 })
    const link = screen.getByRole('button', { name: 'All Boards' })
    expect(pageTitle.parentElement).toBe(link.parentElement?.parentElement)
    expect(link.parentElement).toHaveStyle({ justifyContent: 'flex-end' })
    expect(pageTitle).toHaveClass('MuiTypography-h5')
    expect(pageTitle.parentElement).toHaveStyle({
      display: 'flex',
      justifyContent: 'space-between',
    })
    expect(link).toHaveClass('MuiButton-contained')
    expect(pageTitle.parentElement?.parentElement).not.toHaveStyle({ padding: '24px' })
    // The Cards/Table toggle lives in the title row, left of All Boards.
    const toggle = screen.getByRole('button', { name: 'Cards view' })
    expect(toggle.closest('.MuiToggleButtonGroup-root')?.parentElement).toBe(link.parentElement)
    // No My Markers heading; the filter bar sits above the Boards row.
    expect(screen.queryByRole('heading', { name: 'My Markers' })).not.toBeInTheDocument()
    const boards = screen.getByRole('region', { name: 'Boards' })
    const filters = screen.getByRole('region', { name: 'Filter Boards and Markers' })
    expect(link.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filters.compareDocumentPosition(boards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const markerTile = screen
      .getByRole('button', { name: 'Open Marker: Rose window' })
      .closest('[data-testid="marker-card"]')!
    expect(
      boards.compareDocumentPosition(markerTile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Graph view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag Rose window' })).not.toBeInTheDocument()
    const card = screen
      .getByRole('button', { name: 'Open Marker: Rose window' })
      .closest('[data-testid="marker-card"]')!
    expect(card).not.toHaveStyle({ minHeight: '235px' })
    expect(card.parentElement?.parentElement).toHaveStyle({
      gridTemplateColumns: 'repeat(auto-fill, 234px)',
    })
    expect(card.querySelector('img')).toHaveStyle({ height: '96px' })
    expect(within(card).queryByTestId('collection-visibility-chip')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Architecture inspiration' })).getByTestId(
        'collection-visibility-chip',
      ),
    ).toHaveTextContent('Private')
    expect(within(card).getByTestId('StarIcon')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit Marker: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Actions for Rose window' }),
    ).not.toBeInTheDocument()
  })
  it('offers equivalent table columns and preserves actions and filters across view changes', async () => {
    const view = await setup(null, {
      categories: [makeCategory({ id: 1, label: 'Architecture' })],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = within(screen.getByRole('table', { name: 'Markers' }))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '',
      'Thumbnail',
      'Title',
      'Image',
      'Description',
      'Category',
      'Boards',
      'Favourite',
      'Owner',
      'Created',
      'Modified',
      'Actions',
    ])
    const row = within(table.getByText('Rose window').closest('tr')!)
    expect(row.queryByRole('button', { name: 'Rose window' })).not.toBeInTheDocument()
    // Category cell renders the Browse breadcrumb (segment links), not the
    // flat marker category_name — it swaps in once the image lookup resolves.
    expect(await row.findByRole('button', { name: 'Architecture' })).toBeVisible()
    fireEvent.click(row.getByRole('button', { name: 'Architecture inspiration' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(1)
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    fireEvent.click(row.getByRole('button', { name: 'View Marker: Rose window' }))
    expect(view.onOpenMarker).toHaveBeenCalledWith(BOARD_ITEMS[0])
    view.onOpenMarker.mockClear()
    fireEvent.click(row.getByRole('button', { name: 'Architecture' }))
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    fireEvent.click(row.getByText('Rose window'))
    await screen.findByRole('dialog', { name: 'Edit Marker' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit Marker' })).not.toBeInTheDocument(),
    )
    fireEvent.click(row.getByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(7, { version: 3, favourite: false }),
    )
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    fireEvent.click(row.getByRole('button', { name: 'Actions for Rose window' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move/Save to Board' }))
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.click(row.getByRole('button', { name: 'Actions for Rose window' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit Details' }))
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(table.getAllByRole('button', { name: 'Architecture' })).toHaveLength(BOARD_ITEMS.length)
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Filter Boards and Markers' })).getByRole(
        'button',
        { name: 'Title' },
      ),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Boards and Markers by title' }), {
      target: { value: 'No such view' },
    })
    expect(screen.getByText('No matching Markers.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cards view' }))
    expect(screen.queryByTestId('marker-card')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByTestId('marker-card')).toHaveLength(BOARD_ITEMS.length)
  })
  it('lets the Marker table choose columns and persists them per user', async () => {
    const user = userEvent.setup()
    try {
      await setup()
      const filters = screen.getByRole('region', { name: 'Filter Boards and Markers' })
      expect(
        within(filters).queryByRole('button', { name: 'Choose columns' }),
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
      await user.click(within(filters).getByRole('button', { name: 'Choose columns' }))
      const dialog = await screen.findByRole('dialog')
      expect(
        Array.from(dialog.querySelectorAll('.MuiFormControlLabel-root')).map(
          (label) => label.textContent,
        ),
      ).toEqual([
        'Thumbnail',
        'Title',
        'Image',
        'Description',
        'Category',
        'Boards',
        'Favourite',
        'Owner',
        'Created',
        'Modified',
      ])
      expect(
        within(dialog).getByRole('button', { name: 'Reorder Boards column' }),
      ).toBeInTheDocument()
      await user.click(within(dialog).getByRole('checkbox', { name: 'Boards' }))
      await user.click(within(dialog).getByRole('button', { name: 'Done' }))
      // The MUI close transition keeps aria-modal masking the page briefly.
      const table = within(await screen.findByRole('table', { name: 'Markers' }))
      expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        '',
        'Thumbnail',
        'Title',
        'Image',
        'Description',
        'Category',
        'Favourite',
        'Owner',
        'Created',
        'Modified',
        'Actions',
      ])
      expect(
        JSON.parse(localStorage.getItem('hrivpref:table-columns:markers:user:anonymous') ?? '{}'),
      ).toMatchObject({ boards: false })
    } finally {
      localStorage.removeItem('hrivpref:table-columns:markers:user:anonymous')
    }
  })
  it('renders Marker table columns in the stored order', async () => {
    localStorage.setItem(
      'hrivpref:table-column-order:markers:user:anonymous',
      JSON.stringify(['boards', 'favourite', 'title', 'category']),
    )
    try {
      await setup()
      fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
      expect(
        within(screen.getByRole('table', { name: 'Markers' }))
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent),
      ).toEqual([
        '',
        'Boards',
        'Favourite',
        'Title',
        'Category',
        'Thumbnail',
        'Image',
        'Description',
        'Owner',
        'Created',
        'Modified',
        'Actions',
      ])
    } finally {
      localStorage.removeItem('hrivpref:table-column-order:markers:user:anonymous')
    }
  })
  it('opens the Marker edit dialog from focused table rows but ignores nested controls', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const row = within(screen.getByRole('table')).getByText('Rose window').closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    row.focus()
    expect(row).toHaveFocus()
    await view.user.keyboard('{Enter}')
    expect(view.onOpenMarker).not.toHaveBeenCalled()
    await screen.findByRole('dialog', { name: 'Edit Marker' })
    await view.user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit Marker' })).not.toBeInTheDocument(),
    )
    for (const key of ['Enter', ' ']) {
      fireEvent.keyDown(within(row).getByRole('button', { name: 'Favourite Rose window' }), { key })
    }
    expect(view.onOpenMarker).not.toHaveBeenCalled()
  })
  it('keeps move, edit and delete reachable without a Marker overflow menu', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Save “Rose window” to…')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Marker: Rose window' }))
    expect(await screen.findByRole('button', { name: 'Delete Marker' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeVisible()
  })
  it('exposes table row actions under a Marker overflow menu', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = within(screen.getByRole('table', { name: 'Markers' }))
    const row = within(table.getByText('Rose window').closest('tr')!)
    fireEvent.click(row.getByRole('button', { name: 'Actions for Rose window' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Marker' }))
    await waitFor(() => expect(view.onOpenMarker).toHaveBeenCalledWith(BOARD_ITEMS[0]))
    fireEvent.click(row.getByRole('button', { name: 'Actions for Rose window' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Marker?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteMarker).toHaveBeenCalledWith(7, 3))
  })
  it.each([
    ['Cards', true],
    ['Cards', false],
    ['Table', true],
    ['Table', false],
  ] as const)(
    'hides read-only favourite controls in %s with favourite=%s',
    async (view, favourite) => {
      vi.mocked(api.fetchMarkers).mockResolvedValue([
        { ...BOARD_ITEMS[0], favourite, permissions: { can_edit: false, can_delete: false } },
      ])
      await setup()
      fireEvent.click(screen.getByRole('button', { name: `${view} view` }))
      expect(
        screen.queryByRole('button', { name: 'Favourite Rose window' }),
      ).not.toBeInTheDocument()
      const indicator = screen.queryByRole('img', { name: 'Favourite Rose window' })
      if (favourite) {
        expect(indicator).toBeVisible()
        expect(indicator!.querySelector('svg')).toHaveStyle({ color: 'rgb(255, 255, 255)' })
      } else expect(indicator).not.toBeInTheDocument()
      expect(api.updateMarker).not.toHaveBeenCalled()
    },
  )
  it.each(['Cards', 'Table'])('uses a white filled favourite star in %s', async (view) => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: `${view} view` }))
    const toggle = screen.getByRole('button', { name: 'Favourite Rose window' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(toggle).getByTestId('StarIcon')).toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })
  it('retains table rows and exposes errors when a favourite mutation fails', async () => {
    vi.mocked(api.updateMarker).mockRejectedValue(
      new api.ApiError(422, 'Unable to update favourite'),
    )
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update favourite')
    expect(within(screen.getByRole('table')).getByText('Rose window')).toBeVisible()
  })
  it.each(['Boards', 'Markers'])(
    'shows an initial %s load error instead of the empty state and allows retry',
    async (source) => {
      const fetch = source === 'Boards' ? vi.mocked(api.fetchBoards) : vi.mocked(api.fetchMarkers)
      fetch.mockRejectedValueOnce(new api.ApiError(422, 'Overview unavailable'))
      await setup()
      expect(screen.getByRole('alert')).toHaveTextContent('Overview unavailable')
      expect(screen.queryByText(/No Markers yet/)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
      await screen.findByRole('button', { name: 'Open Marker: Rose window' })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )
  it('retains the loaded collage and covers when a silent refresh fails and allows retry', async () => {
    await setup()
    const card = screen.getByRole('button', { name: 'Open Marker: Rose window' })
    const cover = screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })
    vi.mocked(api.fetchBoards).mockRejectedValueOnce(new api.ApiError(422, 'Overview unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Overview unavailable')
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBe(card)
    expect(screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })).toBe(cover)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/No Markers yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBe(card)
  })
  it('keeps collage nodes mounted throughout a drag-save and silent refresh', async () => {
    const { container } = await setup()
    const card = screen.getByRole('button', { name: 'Open Marker: Rose window' })
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
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBe(card)
    expect(api.fetchBoards).toHaveBeenCalledTimes(2)
    expect(api.fetchMarkers).toHaveBeenCalledTimes(4)
  })
  it('does not reload or remount the collage for Marker editing, Board creation or Board navigation', async () => {
    const view = await setup()
    const card = screen.getByRole('button', { name: 'Open Marker: Rose window' })
    const cover = screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })
    await actions()
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(card.isConnected).toBe(true)
    expect(cover.isConnected).toBe(true)
    expect(api.fetchBoards).toHaveBeenCalledTimes(2) // overview and the form's Board picker
    expect(api.fetchMarkers).toHaveBeenCalledTimes(3) // overview and two owned Board covers
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
          onOpenMarker={view.onOpenMarker}
        />
      </AuthContext.Provider>,
    )
    await screen.findByRole('dialog', { name: 'Next studio project Board' })
    expect(card.isConnected).toBe(true)
    expect(cover.isConnected).toBe(true)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(api.fetchBoards).toHaveBeenCalledTimes(2)
    expect(api.fetchMarkers).toHaveBeenCalledTimes(3)
  })
  it('filters both surfaces by title and restores them with Clear filters', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([
      { ...BOARDS_FIXTURES[0], name: 'Rose studies' },
      BOARDS_FIXTURES[1],
    ])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Boards and Markers by title' }), {
      target: { value: 'Rose' },
    })
    expect(screen.getByRole('button', { name: 'Open Board: Rose studies' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Next studio project' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Marker: Stone columns' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: 'Open Marker: Stone columns' })).toBeVisible()
  })
  it('offers deduplicated Board and Marker owners, including owners with no visible Board', async () => {
    const guestOwner = { user_id: 88, program_id: null, name: 'Taylor', role: 'student' as const }
    vi.mocked(api.fetchMarkers).mockResolvedValue([
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
    expect(screen.queryByRole('button', { name: /^Open Marker:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open Board:/ })).not.toBeInTheDocument()
  })
  it('uses visible Board memberships for scope, including multiple scopes on one Marker', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...BOARD_ITEMS[0], board_ids: [1, 2] },
      { ...BOARD_ITEMS[1], board_ids: [1] },
    ])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Public' }))
    expect(
      screen.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Marker: Stone columns' }),
    ).not.toBeInTheDocument()
  })
  it('shows the associated image name below the title', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...BOARD_ITEMS[0], category_name: 'Architecture' },
      { ...BOARD_ITEMS[1], category_name: null },
    ])
    await setup()
    // Both fixture markers point at image 42 — "Cathedral nave" — so the
    // caption shows the image name, not the category.
    expect(screen.getAllByText('Cathedral nave', { exact: true })).toHaveLength(2)
  })
  it('pins a tile cover from the Board cover picker', async () => {
    await setup()
    // Only editable Boards carry the cover picker action.
    expect(
      screen.queryByRole('button', { name: 'Set Shared discoveries cover image' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Architecture inspiration cover image' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Choose Cover Image' })
    expect(within(dialog).getByRole('radio', { name: /Automatic/ })).toBeChecked()
    await waitFor(() =>
      expect(
        within(dialog).getByRole('radio', { name: /Use Rose window as the cover image/ }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(
      within(dialog).getByRole('radio', { name: /Use Rose window as the cover image/ }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateBoard).toHaveBeenCalledWith(1, {
        version: BOARDS_FIXTURES[0].version,
        cover_marker_id: BOARD_ITEMS[0].id,
        cover_blank: false,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('restores the first-member fallback or blanks the tile from the cover picker', async () => {
    await setup()
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Architecture inspiration cover image' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Choose Cover Image' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /None.*blank card/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateBoard).toHaveBeenCalledWith(1, {
        version: BOARDS_FIXTURES[0].version,
        cover_marker_id: null,
        cover_blank: true,
      }),
    )
  })
  it('drops the cached fallback thumbnail once a Board is set to a blank cover', async () => {
    await setup()
    const tile = () => screen.getByRole('button', { name: 'Open Board: Architecture inspiration' })
    await waitFor(() => expect(tile().querySelector('img')).not.toBeNull())
    vi.mocked(api.fetchBoards).mockResolvedValue(
      BOARDS_FIXTURES.map((row) =>
        row.id === 1
          ? { ...row, version: row.version + 1, cover_blank: true, cover_thumb: null }
          : row,
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Architecture inspiration cover image' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Choose Cover Image' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /None.*blank card/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(tile().querySelector('img')).toBeNull())
  })
  it('opens Board details in a dialog with fixed heading controls and a close action', async () => {
    const view = await setup(1)
    const dialog = screen.getByRole('dialog', { name: 'Architecture inspiration Board' })
    expect(
      within(dialog.querySelector('#board-heading')!).getByText('Private', { exact: true }),
    ).toBeVisible()
    expect(within(dialog).getByText('(6 markers)')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Board' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(null)
  })
  it('saves an overview drag to a Board without removing existing memberships and reports success', async () => {
    await setup()
    dropOnBoard(3)
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [
          { board_id: 1, sort_order: BOARD_ITEMS[0].sort_order },
          { board_id: 3 },
        ],
      }),
    )
    expect(await screen.findByText('Saved to Next studio project')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-filledSuccess')
    expect(screen.getByRole('alert').parentElement).toHaveClass(
      'MuiSnackbar-anchorOriginBottomCenter',
    )
  })
  it.each([
    [2, "You can't add Markers to Shared discoveries"],
    [1, 'Already in Architecture inspiration'],
    [999, 'This Board is no longer available. Reload before saving.'],
  ] as const)('explains a rejected drop on Board %s without writing', async (id, message) => {
    await setup()
    dropOnBoard(id)
    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveClass(
      id === 1 ? 'MuiAlert-filledInfo' : 'MuiAlert-filledWarning',
    )
    expect(screen.getByRole('alert').parentElement).toHaveClass(
      'MuiSnackbar-anchorOriginBottomCenter',
    )
    expect(api.updateMarker).not.toHaveBeenCalled()
  })
  it('explains when the dropped Marker cannot be edited', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      { ...BOARD_ITEMS[0], permissions: { can_edit: false, can_delete: false } },
    ])
    await setup()
    dropOnBoard(3)
    expect(
      await screen.findByText("You can't add this Marker to Next studio project"),
    ).toBeVisible()
    expect(api.updateMarker).not.toHaveBeenCalled()
  })
  it('explains when the dropped Marker is no longer available', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([])
    await setup()
    dropOnBoard(3)
    expect(
      await screen.findByText('This Marker is no longer available. Reload before saving.'),
    ).toBeVisible()
    expect(api.updateMarker).not.toHaveBeenCalled()
  })
  it('does not show a rejection or write for a cancelled drop', async () => {
    await setup()
    drag.end?.({
      canceled: true,
      operation: { source: { id: 'item:7', type: 'board-member' }, target: { id: 'save:1' } },
    } as unknown as DragEndEvent)
    expect(screen.queryByText('Already in Architecture inspiration')).not.toBeInTheDocument()
    expect(api.updateMarker).not.toHaveBeenCalled()
  })
  it('explains rejection while another mutation is pending', async () => {
    vi.mocked(api.updateMarker).mockReturnValue(new Promise(() => {}))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    dropOnBoard(3)
    expect(await screen.findByText('Wait for the current change to finish.')).toBeVisible()
    expect(api.updateMarker).toHaveBeenCalledTimes(1)
  })
  it('explains rejection after a conflict', async () => {
    vi.mocked(api.updateMarker).mockRejectedValue(new api.ApiError(409, 'Conflict'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    await screen.findByRole('alert')
    dropOnBoard(3)
    expect(await screen.findByText('Reload latest changes before dropping Markers.')).toBeVisible()
    expect(api.updateMarker).toHaveBeenCalledTimes(1)
  })
  it('explains rejected reorder in a read-only opened Board', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue({
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_edit: false },
    })
    await setup(1)
    await screen.findByRole('button', { name: 'Open Marker: Rose window' })
    drag.end?.({
      canceled: false,
      operation: { source: { id: 'item:7', type: 'board-member' }, target: { id: 'item:8' } },
    } as unknown as DragEndEvent)
    expect(
      await screen.findByText("You can't reorder Markers in Architecture inspiration"),
    ).toBeVisible()
    expect(api.reorderBoardMarkers).not.toHaveBeenCalled()
  })
  it('reorders Boards, shows Order saved, and undoes the reorder', async () => {
    vi.mocked(api.reorderBoards).mockResolvedValueOnce(
      BOARDS_FIXTURES.map((row) => ({ ...row, version: row.version + 10 })),
    )
    await setup()
    drag.end?.({
      canceled: false,
      operation: {
        source: { id: 'board:1', type: 'board-card', index: 1, initialIndex: 0 },
      },
    } as unknown as DragEndEvent)
    await waitFor(() => expect(api.reorderBoards).toHaveBeenCalled())
    expect(vi.mocked(api.reorderBoards).mock.calls[0][0].map((item) => item.board_id)).toEqual([
      3, 1,
    ])
    expect(await screen.findByText('Order saved')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-filledSuccess')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.reorderBoards).toHaveBeenCalledTimes(2))
    // Undo carries the versions the reorder returned, not refreshed ones.
    expect(vi.mocked(api.reorderBoards).mock.calls[1][0]).toEqual(
      [1, 3].map((board_id) => ({
        board_id,
        version: BOARDS_FIXTURES.find((row) => row.id === board_id)!.version + 10,
      })),
    )
    await waitFor(() => expect(screen.queryByText('Order saved')).not.toBeInTheDocument())
  })
  it('reorders overview Markers, shows Order saved, and undoes the reorder', async () => {
    vi.mocked(api.reorderMarkers).mockResolvedValueOnce(
      BOARD_ITEMS.map((item) => ({ ...item, version: item.version + 10 })),
    )
    await setup()
    drag.end?.({
      canceled: false,
      operation: {
        source: { id: 'item:7', type: 'board-member', index: 2, initialIndex: 0 },
      },
    } as unknown as DragEndEvent)
    await waitFor(() => expect(api.reorderMarkers).toHaveBeenCalled())
    expect(vi.mocked(api.reorderMarkers).mock.calls[0][0].map((item) => item.marker_id)).toEqual([
      8, 9, 7, 10, 11, 12,
    ])
    expect(await screen.findByText('Order saved')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-filledSuccess')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.reorderMarkers).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.reorderMarkers).mock.calls[1][0]).toEqual(
      [7, 8, 9, 10, 11, 12].map((marker_id) => ({
        marker_id,
        version: BOARD_ITEMS.find((item) => item.id === marker_id)!.version + 10,
      })),
    )
  })
  it('offers no Undo when the reorder response omits a reordered Marker', async () => {
    vi.mocked(api.reorderMarkers).mockResolvedValueOnce(BOARD_ITEMS.slice(1))
    await setup()
    drag.end?.({
      canceled: false,
      operation: {
        source: { id: 'item:7', type: 'board-member', index: 2, initialIndex: 0 },
      },
    } as unknown as DragEndEvent)
    expect(await screen.findByText('Order saved')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
  it('shows Order saved with undo after reordering Markers inside an opened Board', async () => {
    vi.mocked(api.reorderBoardMarkers).mockResolvedValueOnce({
      ...BOARDS_FIXTURES[0],
      version: BOARDS_FIXTURES[0].version + 1,
    })
    await setup(1)
    await screen.findByRole('dialog', { name: 'Architecture inspiration Board' })
    drag.end?.({
      canceled: false,
      operation: {
        source: { id: 'item:7', type: 'board-member' },
        target: { id: 'item:9' },
      },
    } as unknown as DragEndEvent)
    await waitFor(() =>
      expect(api.reorderBoardMarkers).toHaveBeenCalledWith(1, {
        version: BOARDS_FIXTURES[0].version,
        items: [8, 9, 7, 10, 11, 12].map((marker_id) => ({ marker_id })),
      }),
    )
    expect(await screen.findByText('Order saved')).toBeVisible()
    // The snackbar portals outside the aria-modal dialog, so role queries
    // cannot reach its action; match by text instead.
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() =>
      expect(api.reorderBoardMarkers).toHaveBeenCalledWith(1, {
        version: BOARDS_FIXTURES[0].version + 1,
        items: [7, 8, 9, 10, 11, 12].map((marker_id) => ({ marker_id })),
      }),
    )
  })
  it('undoes a member reorder on its own Board after another Board opens', async () => {
    vi.mocked(api.reorderBoardMarkers).mockResolvedValueOnce({
      ...BOARDS_FIXTURES[0],
      version: BOARDS_FIXTURES[0].version + 1,
    })
    const view = await setup(1)
    await screen.findByRole('dialog', { name: 'Architecture inspiration Board' })
    drag.end?.({
      canceled: false,
      operation: {
        source: { id: 'item:7', type: 'board-member' },
        target: { id: 'item:9' },
      },
    } as unknown as DragEndEvent)
    expect(await screen.findByText('Order saved')).toBeVisible()
    view.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <BoardsPage
          enabled
          currentUser={BOARD_USER}
          boardId={null}
          onSelectBoard={view.onSelectBoard}
          onOpenMarker={view.onOpenMarker}
        />
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(api.reorderBoardMarkers).toHaveBeenCalledTimes(2))
    expect(api.reorderBoardMarkers).toHaveBeenLastCalledWith(1, {
      version: BOARDS_FIXTURES[0].version + 1,
      items: [7, 8, 9, 10, 11, 12].map((marker_id) => ({ marker_id })),
    })
  })
  it('reports a failed drag-save without a success snackbar', async () => {
    vi.mocked(api.updateMarker).mockRejectedValue(new api.ApiError(422, 'Cannot save this view'))
    await setup()
    dropOnBoard(3)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save this view')
    expect(screen.queryByText('Saved to Next studio project')).not.toBeInTheDocument()
  })
  it('discards Board-local dialogs and late mutation reloads after navigating to another Board', async () => {
    let finish: (item: (typeof BOARD_ITEMS)[0]) => void = () => {}
    vi.mocked(api.updateMarker).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const view = await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() => expect(api.updateMarker).toHaveBeenCalled())
    view.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <BoardsPage
          enabled
          currentUser={BOARD_USER}
          boardId={3}
          onSelectBoard={view.onSelectBoard}
          onOpenMarker={view.onOpenMarker}
        />
      </AuthContext.Provider>,
    )
    await screen.findByRole('dialog', { name: 'Next studio project Board' })
    finish(BOARD_ITEMS[0])
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Next studio project Board' })).toBeVisible()
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
    expect(within(row).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(1)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Reorder ${readOnly.name}` }),
    ).not.toBeInTheDocument()
  })

  it.each(['staff', 'instructor', 'admin'] as const)(
    'puts read-only program-owned Boards in discovery rather than chips for %s',
    async (role) => {
      const readOnly = {
        ...BOARDS_FIXTURES[1],
        owners: [],
        owner_program_id: 1,
        permissions: { ...BOARDS_FIXTURES[1].permissions, can_edit: false },
      }
      vi.mocked(api.fetchBoards).mockResolvedValue([BOARDS_FIXTURES[0], readOnly])
      const view = await setup(null, { currentUser: { ...BOARD_USER, role } })
      const row = screen.getByRole('region', { name: 'Boards' })
      expect(
        within(row).queryByRole('button', { name: `Open Board: ${readOnly.name}` }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: `Reorder ${readOnly.name}` }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('group', { name: BOARDS_FIXTURES[0].name })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
      const dialog = await screen.findByRole('dialog', { name: 'All Boards' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Public & Shared' }))
      fireEvent.click(within(dialog).getByRole('button', { name: `Open Board: ${readOnly.name}` }))
      expect(view.onSelectBoard).toHaveBeenCalledWith(readOnly.id)
    },
  )
  it('puts a directly owned read-only Board in discovery when no editable chips remain', async () => {
    const readOnly = {
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_edit: false },
    }
    vi.mocked(api.fetchBoards).mockResolvedValue([readOnly])
    await setup()
    expect(
      within(screen.getByRole('region', { name: 'Boards' })).queryByRole('button', {
        name: /^Open Board:/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Board' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
    const dialog = await screen.findByRole('dialog', { name: 'All Boards' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Public & Shared' }))
    expect(
      within(dialog).getByRole('button', { name: `Open Board: ${readOnly.name}` }),
    ).toBeVisible()
  })
  it('renews a Marker thumbnail via its own endpoint, not the image id', async () => {
    vi.mocked(api.fetchMarker).mockResolvedValue({ ...BOARD_ITEMS[0], thumb: '/renewed.jpg' })
    await setup()
    const card = screen.getByRole('button', { name: 'Open Marker: Rose window' })
    const image = card.querySelector('img')
    expect(image).not.toBeNull()
    if (image) {
      fireEvent.error(image)
      await waitFor(() => expect(image).toHaveAttribute('src', '/renewed.jpg'))
    }
    expect(api.fetchMarker).toHaveBeenCalledWith(7)
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
    expect(screen.getByRole('heading', { name: 'Boards and Markers' })).toHaveClass(
      'MuiTypography-h5',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open Marker: Rose window' }))
    expect(view.onOpenMarker).toHaveBeenCalledWith(BOARD_ITEMS[0])
    fireEvent.click(screen.getByRole('button', { name: 'New Board' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('New Board')
  })
  it('lists others’ Boards through the Public & Shared filter and opens the existing Board route', async () => {
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
    const dialog = screen.getByRole('dialog', { name: 'All Boards' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Public & Shared' }))
    expect(
      within(dialog).queryByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Reorder Shared discoveries' }),
    ).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Board: Shared discoveries' }))
    expect(view.onSelectBoard).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it.each(['admin', 'instructor', 'staff', 'student'] as const)(
    'scopes discovery for %s while rendering scope and manager metadata',
    async (role) => {
      const privateBoard = {
        ...BOARDS_FIXTURES[2],
        id: 20,
        name: 'Morgan private Board',
        visibility: 'private' as const,
      }
      const restrictedBoard = {
        ...BOARDS_FIXTURES[2],
        id: 21,
        name: 'Studio Board',
        visibility: 'restricted' as const,
        program_ids: [1],
        group_ids: [1],
      }
      const programBoard = {
        ...BOARDS_FIXTURES[0],
        id: 22,
        name: 'Design program Board',
        owner_program_id: 1,
        owners: [{ user_id: null, program_id: 1, name: 'Design', role: null }],
        permissions: { ...BOARDS_FIXTURES[0].permissions, can_edit: false },
      }
      const orphanBoard = { ...BOARDS_FIXTURES[2], id: 23, name: 'Orphan Board', owners: [] }
      const coOwnedBoard = {
        ...privateBoard,
        id: 24,
        name: 'Co-owned Board',
        owners: [...privateBoard.owners, ...BOARDS_FIXTURES[0].owners],
      }
      const boards = [
        BOARDS_FIXTURES[0],
        BOARDS_FIXTURES[2],
        privateBoard,
        restrictedBoard,
        programBoard,
        orphanBoard,
        coOwnedBoard,
      ]
      vi.mocked(api.fetchBoards).mockResolvedValue(boards)
      const view = await setup(null, { currentUser: { ...BOARD_USER, role } })
      const allButton = screen.queryByRole('button', { name: 'All Boards' })
      expect(allButton != null).toBe(role !== 'student')
      if (!allButton) return
      expect(allButton).toHaveClass('MuiButton-contained')
      fireEvent.click(allButton)
      const all = screen.getByRole('dialog', { name: 'All Boards' })
      const tiles = () => within(all).getAllByRole('button', { name: /^Open Board:/ })
      expect(tiles()).toHaveLength(boards.length)
      const publicTile = within(all).getByRole('button', {
        name: 'Open Board: Shared discoveries',
      })
      expect(within(publicTile).getByRole('heading', { name: 'Shared discoveries' })).toBeVisible()
      expect(within(publicTile).getByText('Managed by Morgan')).toBeVisible()
      expect(within(publicTile).getByTestId('collection-visibility-chip')).toHaveTextContent(
        'Public',
      )
      const restrictedTile = within(all).getByRole('button', {
        name: `Open Board: ${restrictedBoard.name}`,
      })
      expect(within(restrictedTile).getByTestId('collection-visibility-chip')).toHaveTextContent(
        'Restricted',
      )
      expect(within(all).getByText('Managed by program Design')).toBeVisible()
      expect(within(all).getByText('No owner')).toBeVisible()
      expect(within(all).getByText('Managed by Morgan, Alex')).toBeVisible()
      // Chip filters sit under the title and narrow the grid in place.
      fireEvent.click(within(all).getByRole('button', { name: 'Public & Shared' }))
      expect(tiles()).toHaveLength(5)
      expect(
        within(all).queryByRole('button', { name: `Open Board: ${privateBoard.name}` }),
      ).not.toBeInTheDocument()
      expect(
        within(all).queryByRole('button', { name: `Open Board: ${BOARDS_FIXTURES[0].name}` }),
      ).not.toBeInTheDocument()
      fireEvent.click(within(all).getByRole('button', { name: 'Public & Shared' }))
      expect(tiles()).toHaveLength(boards.length)
      fireEvent.click(within(all).getByRole('button', { name: 'Instructor Boards' }))
      expect(tiles()).toHaveLength(5)
      expect(
        within(all).queryByRole('button', { name: `Open Board: ${orphanBoard.name}` }),
      ).not.toBeInTheDocument()
      expect(
        within(all).queryByRole('button', { name: `Open Board: ${BOARDS_FIXTURES[0].name}` }),
      ).not.toBeInTheDocument()
      expect(
        within(all).queryByRole('button', { name: `Open Board: ${privateBoard.name}` }),
      ).toBeInTheDocument()
      fireEvent.click(within(all).getByRole('button', { name: 'Public & Shared' }))
      expect(tiles()).toHaveLength(6)
      fireEvent.click(within(all).getByRole('button', { name: 'Instructor Boards' }))
      fireEvent.click(within(all).getByRole('button', { name: 'Public & Shared' }))
      expect(tiles()).toHaveLength(boards.length)
      const privateTile = within(all).getByRole('button', {
        name: `Open Board: ${privateBoard.name}`,
      })
      expect(within(privateTile).getByTestId('collection-visibility-chip')).toHaveTextContent(
        'Private',
      )
      expect(within(privateTile).getByText('Managed by Morgan')).toBeVisible()
      fireEvent.click(privateTile)
      expect(view.onSelectBoard).toHaveBeenCalledWith(privateBoard.id)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    },
  )
  it('shows an empty All Boards dialog', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([])
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
    expect(
      within(screen.getByRole('dialog', { name: 'All Boards' })).getByText('No Boards available.'),
    ).toBeVisible()
  })
  it('reports no matches when a discovery filter excludes every Board and closes cleanly', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([BOARDS_FIXTURES[0]])
    const view = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
    const dialog = screen.getByRole('dialog', { name: 'All Boards' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Public & Shared' }))
    expect(within(dialog).getByText('No matching Boards.')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(view.onSelectBoard).not.toHaveBeenCalled()
  })
  it('shows overview read errors rather than an empty All Boards list', async () => {
    vi.mocked(api.fetchBoards).mockRejectedValue(new api.ApiError(503, 'Unavailable'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'All Boards' }))
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      'Unable to load Boards.',
    )
  })
  it('excludes non-owned Markers even when their Board is owned', async () => {
    vi.mocked(api.fetchMarkers).mockResolvedValue([
      BOARD_ITEMS[0],
      { ...BOARD_ITEMS[1], owners: BOARDS_FIXTURES[2].owners },
    ])
    await setup()
    expect(screen.getByRole('button', { name: 'Open Marker: Rose window' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Marker: Stone columns' }),
    ).not.toBeInTheDocument()
  })
  it('filters favourites on the server and toggles them with the Marker version', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    await waitFor(() =>
      expect(api.fetchMarkers).toHaveBeenCalledWith(expect.objectContaining({ favourite: true })),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Favourite Rose window' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(7, { version: 3, favourite: false }),
    )
  })

  it('uses Collection scope and owner controls without a Board overflow menu', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue({
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_transfer: true },
      owners: [
        ...BOARDS_FIXTURES[0].owners,
        { user_id: 77, program_id: null, name: 'Morgan', role: 'instructor' },
      ],
    })
    await setup(1)
    const dialog = screen.getByRole('dialog', { name: 'Architecture inspiration Board' })
    const scope = within(
      within(dialog).getByRole('group', { name: 'Board scope and owners' }),
    ).getByTestId('collection-visibility-chip')
    expect(scope).toHaveTextContent('Private')
    expect(scope.querySelector('svg')).not.toBeNull()
    expect(scope.parentElement).toHaveTextContent('Managed by Alex, Morgan')
    expect(screen.queryByRole('button', { name: 'Board options' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: 'Architecture inspiration Board' }),
    ).toHaveClass('MuiTypography-h6')
    expect(within(dialog).getByText('(6 markers)')).toHaveClass('MuiTypography-body2')
    const sequence = within(dialog).getByRole('button', { name: 'Create Collection' })
    expect(sequence).toHaveClass('MuiButton-outlined')
    expect(sequence.nextElementSibling).toBe(
      within(dialog).getByRole('button', { name: 'Close Board' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage owners' }))
    expect(await screen.findByRole('dialog', { name: 'Owners' })).toBeVisible()
  })
  it('disables sequence creation for an empty Board and respects the feature flag', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[1])
    const view = await setup(3)
    expect(screen.getByRole('button', { name: 'Create Collection' })).toBeDisabled()
    view.rerender(
      <BoardsPage
        enabled
        currentUser={BOARD_AUTH.currentUser}
        collectionsEnabled={false}
        boardId={3}
        onSelectBoard={vi.fn()}
        onOpenMarker={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Create Collection' })).not.toBeInTheDocument()
  })
  it('hides management actions without permissions', async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[2])
    await setup(2)
    expect(screen.queryByRole('button', { name: 'Edit Board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage owners' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
  })

  it('preserves editable links and positions when saving to another Board', async () => {
    const extra = {
      ...BOARDS_FIXTURES[0],
      id: 4,
      markers: [{ ...BOARDS_FIXTURES[0].markers[0], sort_order: 17 }],
    }
    vi.mocked(api.fetchMarker).mockResolvedValue({ ...BOARD_ITEMS[0], board_ids: [1, 4, 2] })
    vi.mocked(api.fetchBoard).mockImplementation(async (id) =>
      id === 4 ? extra : (BOARDS_FIXTURES.find((board) => board.id === id) ?? BOARDS_FIXTURES[0]),
    )
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [
          { board_id: 1, sort_order: 0 },
          { board_id: 4, sort_order: 17 },
          { board_id: 3 },
        ],
      }),
    )
  })
  it('saves on Ctrl+Enter from the Destination Board control', async () => {
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    const destination = screen.getByRole('combobox', { name: 'Destination Board' })
    fireEvent.keyDown(destination, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.updateMarker).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('moves across Boards atomically when explicitly requested', async () => {
    await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move/Save Rose window to Board' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('switch', { name: 'Move: also remove from this Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(7, {
        version: 3,
        board_assignments: [{ board_id: 3 }],
      }),
    )
  })
  it('never submits a destructive partial assignment list after a membership read fails', async () => {
    vi.mocked(api.fetchMarker).mockResolvedValue({ ...BOARD_ITEMS[0], board_ids: [1, 4] })
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
    expect(api.updateMarker).not.toHaveBeenCalled()
  })
  it('surfaces the last-Board removal error instead of deleting the Marker', async () => {
    vi.mocked(api.removeBoardMarker).mockRejectedValue(
      new api.ApiError(422, 'A Marker must belong to at least one Board'),
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
    expect(api.removeBoardMarker).toHaveBeenCalledWith(1, 7, 5)
  })
  it('warns about orphan deletion before deleting a Board', async () => {
    const view = await setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Board' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Board' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Board' }))
    expect(dialog).toHaveTextContent('Markers only on this Board will be permanently deleted')
    expect(api.deleteBoard).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Delete Board' }))
    await waitFor(() => expect(view.onSelectBoard).toHaveBeenCalledWith(null))
    expect(api.deleteBoard).toHaveBeenCalledWith(1, 5)
  })
  it('surfaces OCC conflicts with an explicit reload and no optimistic mutation', async () => {
    vi.mocked(api.updateMarker).mockRejectedValueOnce(new api.ApiError(409, 'stale'))
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
    vi.mocked(api.fetchMarkers).mockResolvedValue([])
    await setup()
    expect(screen.getByText(/No Markers yet/)).toBeVisible()
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

it('offers collection actions once a Marker is selected in a Board', async () => {
  await setup(1)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Multi-select' }))
  expect(
    within(dialog).queryByRole('toolbar', { name: 'Selected Markers' }),
  ).not.toBeInTheDocument()
  const checks = within(dialog).getAllByRole('checkbox', { name: /^Select / })
  fireEvent.click(checks[0])
  const toolbar = within(dialog).getByRole('toolbar', { name: 'Selected Markers' })
  expect(within(toolbar).getByRole('button', { name: 'Create Collection' })).toBeEnabled()
  expect(within(toolbar).getByRole('button', { name: 'Add to Collection' })).toBeEnabled()
  expect(
    within(toolbar).queryByRole('button', { name: 'Create Sequence Collection' }),
  ).not.toBeInTheDocument()
  fireEvent.click(checks[1])
  expect(within(toolbar).getByRole('button', { name: 'Create Collection' })).toBeEnabled()
  // The Board-level Create Collection hides while selecting, leaving one.
  expect(within(dialog).getAllByRole('button', { name: 'Create Collection' })).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Multi-select' }))
  expect(within(dialog).getAllByRole('button', { name: 'Create Collection' })).toHaveLength(1)
})

it('does not expose collection controls when collections are disabled', async () => {
  await setup(null, { collectionsEnabled: false })
  expect(screen.queryByRole('button', { name: 'Multi-select' })).not.toBeInTheDocument()
})

it('creates a Sequence from the Board source and navigates to it', async () => {
  const open = vi.fn()
  vi.mocked(api.createCollection).mockResolvedValue(makeApiCollection({ id: 77, type: 'sequence' }))
  await setup(1, {
    onOpenCollection: open,
    categories: [makeCategory({ id: 10, label: 'Studies' })],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }))
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

    markers: [...board.markers].reverse(),
  })
  vi.mocked(api.createCollection).mockResolvedValue(makeApiCollection({ id: 77, type: 'sequence' }))
  await setup(1, { categories: [makeCategory({ id: 10, label: 'Studies' })] })
  fireEvent.click(screen.getByRole('button', { name: 'Multi-select' }))
  const checkboxes = screen.getAllByRole('checkbox', { name: /^Select / })
  expect(checkboxes).toHaveLength(6)
  for (const checkbox of [...checkboxes].reverse()) fireEvent.click(checkbox)
  fireEvent.click(
    within(screen.getByRole('toolbar', { name: 'Selected Markers' })).getByRole('button', {
      name: 'Create Collection',
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
      expect.objectContaining({ type: 'sequence', marker_ids: [12, 11, 10, 9, 8, 7] }),
    ),
  )
})
