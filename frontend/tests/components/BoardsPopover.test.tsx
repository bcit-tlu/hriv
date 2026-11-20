import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardsPopover from '../../src/components/BoardsPopover'
import { BOARDS_FIXTURES, BOARD_USER } from '../../src/components/boardsFixtures'
import type { ApiBoardSummary } from '../../src/types'

const [mine] = BOARDS_FIXTURES
const board = (overrides: Partial<ApiBoardSummary>): ApiBoardSummary => ({
  ...mine,
  cover_thumb: null,
  cover_blank: true,
  ...overrides,
})
const BOARDS = [
  board({ id: 11, name: 'Second', marker_count: 1 }),
  board({ id: 12, name: 'Shared', owners: [{ ...mine.owners[0], user_id: 77, name: 'Morgan' }] }),
  board({ id: 13, name: 'Read-only', permissions: { ...mine.permissions, can_edit: false } }),
  board({ id: 10, name: 'First', marker_count: 4 }),
]

function setup(fetchBoards = vi.fn(async () => BOARDS)) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  const props = {
    anchorEl: anchor,
    currentUser: BOARD_USER,
    onClose: vi.fn(),
    onOpenBoard: vi.fn(),
    onOpenBoardsPage: vi.fn(),
    services: { fetchBoards },
  }
  const view = render(<BoardsPopover {...props} />)
  return { ...props, ...view, user: userEvent.setup(), fetchBoards }
}

describe('BoardsPopover', () => {
  it('stacks only editable owned Boards in API order with Marker counts', async () => {
    const { onOpenBoard, user } = setup()
    const paper = await screen.findByLabelText('My Boards')
    await waitFor(() => expect(within(paper).getByText('Second')).toBeVisible())
    const names = within(paper)
      .getAllByRole('button')
      .map((row) => row.textContent)
    expect(names).toEqual(['Second1 Marker', 'First4 Markers', 'Open Boards & Markers'])
    await user.click(within(paper).getByRole('button', { name: /^First/ }))
    expect(onOpenBoard).toHaveBeenCalledWith(10)
  })
  it('opens the full page from the footer link', async () => {
    const { onOpenBoardsPage, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Open Boards & Markers' }))
    expect(onOpenBoardsPage).toHaveBeenCalledOnce()
  })
  it('shows loading, then the empty state', async () => {
    let resolve: (rows: ApiBoardSummary[]) => void = () => {}
    setup(vi.fn(() => new Promise<ApiBoardSummary[]>((done) => (resolve = done))))
    expect(await screen.findByLabelText('Loading Boards')).toBeInTheDocument()
    resolve([BOARDS[1]])
    expect(await screen.findByText('You have no Boards yet.')).toBeVisible()
  })
  it('surfaces load errors and keeps the footer link', async () => {
    setup(vi.fn(async () => Promise.reject(new Error('Boards unavailable'))))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boards unavailable')
    expect(screen.getByRole('button', { name: 'Open Boards & Markers' })).toBeVisible()
  })
})
