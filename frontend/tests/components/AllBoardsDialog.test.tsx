import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import AllBoardsDialog from '../../src/components/AllBoardsDialog'
import { BOARD_USER } from '../../src/components/boardsFixtures'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../../src/components/markerFixtures'
import type { ApiBoardSummary } from '../../src/types'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoard: vi.fn(),
  fetchMarker: vi.fn(),
  fetchMarkers: vi.fn(),
}))

const me = { user_id: BOARD_USER.id, program_id: null, name: 'Me', role: 'instructor' as const }
const morgan = { user_id: 77, program_id: null, name: 'Morgan', role: 'instructor' as const }
const board = (overrides: Partial<ApiBoardSummary>): ApiBoardSummary => ({
  ...BOARD_FIXTURE,
  owners: [morgan],
  ...overrides,
})
const BOARDS = [
  board({ id: 1, name: 'Histology week 3', visibility: 'public', marker_count: 12 }),
  board({ id: 2, name: 'Blood smear study', visibility: 'restricted', marker_count: 3 }),
  board({ id: 3, name: 'My own notes', visibility: 'private', marker_count: 7, owners: [me] }),
]

function renderDialog(overrides: Partial<Parameters<typeof AllBoardsDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    boards: BOARDS,
    recent: [],
    loading: false,
    error: null,
    currentUser: BOARD_USER,
    onOpenBoard: vi.fn(),
    ...overrides,
  }
  render(<AllBoardsDialog {...props} />)
  return { props, dialog: screen.getByRole('dialog', { name: 'All Boards' }) }
}
const cards = (dialog: HTMLElement) => within(dialog).queryAllByTestId('board-card')
const chip = (dialog: HTMLElement, name: string) =>
  within(dialog)
    .getAllByRole('button', { name })
    .find((el) => el.hasAttribute('aria-pressed')) as HTMLElement

describe('AllBoardsDialog (#1978)', () => {
  beforeEach(() => {
    vi.mocked(api.fetchMarkers).mockReset().mockResolvedValue([])
    localStorage.clear()
  })

  it('opens in Cards view with every Board as a card', () => {
    const { dialog } = renderDialog()
    expect(within(dialog).getByRole('button', { name: 'Cards view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(cards(dialog)).toHaveLength(3)
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
  })

  it('filters by scope, owner and favourites, and clears them all', () => {
    const { dialog } = renderDialog({
      recent: [{ ...MARKER_FIXTURE, favourite: true, board_ids: [2] }],
    })
    fireEvent.click(chip(dialog, 'Public'))
    expect(cards(dialog)).toHaveLength(1)
    expect(within(dialog).getByRole('heading', { name: 'Histology week 3' })).toBeVisible()
    fireEvent.click(chip(dialog, 'Public'))

    fireEvent.click(chip(dialog, 'Favourites'))
    expect(cards(dialog)).toHaveLength(1)
    expect(within(dialog).getByRole('heading', { name: 'Blood smear study' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear filters' }))
    expect(cards(dialog)).toHaveLength(3)
  })

  it('filters by title and shows "No matching Boards." when nothing matches', () => {
    const { dialog } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Title/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter All Boards by title' }), {
      target: { value: 'smear' },
    })
    expect(cards(dialog)).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter All Boards by title' }), {
      target: { value: 'zebrafish' },
    })
    expect(within(dialog).getByText('No matching Boards.')).toBeVisible()
  })

  it('opens a Board from a card and closes the dialog', () => {
    const { dialog, props } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Board: Blood smear study' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onOpenBoard).toHaveBeenCalledWith(2)
  })

  it('switches to a sortable table with owners and opens a Board from its row', () => {
    const { dialog, props } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table view' }))
    const table = within(dialog).getByRole('table', { name: 'All Boards' })
    expect(cards(dialog)).toHaveLength(0)
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Name', 'Markers', 'Scope', 'Owners', 'Updated'])
    const names = () =>
      within(table)
        .getAllByRole('row', { name: /^Open Board:/ })
        .map((el) => el.getAttribute('aria-label')!.replace('Open Board: ', ''))
    // Default sort: name ascending.
    expect(names()).toEqual(['Blood smear study', 'Histology week 3', 'My own notes'])
    fireEvent.click(within(table).getByRole('button', { name: 'Markers' }))
    expect(names()).toEqual(['Blood smear study', 'My own notes', 'Histology week 3'])
    fireEvent.click(within(table).getByRole('button', { name: 'Markers' }))
    expect(names()).toEqual(['Histology week 3', 'My own notes', 'Blood smear study'])
    expect(within(table).getAllByText('Morgan')).toHaveLength(2)

    // Plain-text name cell; the row opens the Board (product-decisions table convention).
    fireEvent.click(within(table).getByText('My own notes'))
    expect(props.onOpenBoard).toHaveBeenCalledWith(3)
  })

  it('still opens a Board from the keyboard with the Name column hidden', async () => {
    const { dialog, props } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table view' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    // The column dialog fades out before the table is reachable again.
    const table = await within(dialog).findByRole('table', { name: 'All Boards' })
    expect(within(table).queryByRole('columnheader', { name: 'Name' })).not.toBeInTheDocument()
    const row = within(table).getByRole('row', { name: 'Open Board: Blood smear study' })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(props.onOpenBoard).toHaveBeenCalledWith(2)
  })

  it('returns to the first page when a filter changes', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      board({
        id: 100 + i,
        name: `Board ${String(i).padStart(2, '0')}`,
        visibility: i % 2 ? 'private' : 'public',
      }),
    )
    const { dialog } = renderDialog({ boards: many })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table view' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go to next page' }))
    expect(within(dialog).getByText('26–50 of 60')).toBeVisible()
    // 30 public Boards still span two pages; the filtered list starts at its first.
    fireEvent.click(chip(dialog, 'Public'))
    expect(within(dialog).getByText('1–25 of 30')).toBeVisible()
  })

  it('offers Choose columns only in Table view', () => {
    const { dialog } = renderDialog()
    // Kept in the bar (hidden) so its height doesn't change between views.
    const choose = within(dialog).getByText('Choose columns').closest('button')
    expect(choose).toHaveAttribute('aria-hidden', 'true')
    expect(choose).toHaveAttribute('tabindex', '-1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table view' }))
    expect(within(dialog).getByRole('button', { name: 'Choose columns' })).toBeVisible()
  })

  it('shows the loading state', () => {
    const { dialog } = renderDialog({ loading: true })
    expect(within(dialog).getByRole('progressbar', { name: 'Loading all Boards' })).toBeVisible()
  })

  it('shows a read error instead of an empty list', () => {
    const { dialog } = renderDialog({ error: 'Boards are unavailable' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Boards are unavailable')
    expect(within(dialog).queryByText('No Boards available.')).not.toBeInTheDocument()
  })
})
