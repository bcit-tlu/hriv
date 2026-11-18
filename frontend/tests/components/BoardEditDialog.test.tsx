import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import BoardEditDialog from '../../src/components/BoardEditDialog'
import {
  BOARD_AUTH,
  BOARD_GROUPS,
  BOARD_PROGRAMS,
  BOARDS_FIXTURES,
} from '../../src/components/boardsFixtures'
vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  createBoard: vi.fn(),
  updateBoard: vi.fn(),
  fetchBoard: vi.fn(),
  deleteBoard: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.createBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.updateBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.fetchBoard).mockResolvedValue({ ...BOARDS_FIXTURES[0], version: 8 })
  vi.mocked(api.deleteBoard).mockResolvedValue()
})
function setup(board?: (typeof BOARDS_FIXTURES)[0], auth = BOARD_AUTH) {
  const onSaved = vi.fn()
  render(
    <AuthContext.Provider value={auth}>
      <BoardEditDialog
        board={board}
        programs={BOARD_PROGRAMS}
        groups={BOARD_GROUPS}
        onClose={vi.fn()}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />
    </AuthContext.Provider>,
  )
  return onSaved
}
describe('BoardEditDialog', () => {
  it('confirms deletion, blocks stale versions and reloads before retrying', async () => {
    vi.mocked(api.deleteBoard).mockRejectedValueOnce(new api.ApiError(409, 'stale'))
    setup(BOARDS_FIXTURES[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete Board' }))
    expect(api.deleteBoard).not.toHaveBeenCalled()
    expect(screen.getByText(/Markers only on this Board will be permanently deleted/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('before deleting')
    expect(screen.getByRole('button', { name: 'Confirm Delete Board' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Board' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete Board' }))
    await waitFor(() => expect(api.deleteBoard).toHaveBeenLastCalledWith(1, 8))
  })
  it('retains the form when deletion fails without an OCC conflict', async () => {
    vi.mocked(api.deleteBoard).mockRejectedValueOnce(new api.ApiError(403, 'Deletion denied'))
    setup(BOARDS_FIXTURES[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion denied')
    expect(screen.getByRole('dialog', { name: 'Edit Board' })).toBeVisible()
  })
  it('hides deletion for new and non-deletable Boards', () => {
    setup({
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_delete: false },
    })
    expect(screen.queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
  })
  it('requires a name and defaults to private', async () => {
    const saved = setup()
    expect(screen.queryByRole('button', { name: 'Delete Board' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Board' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: '  Inspiration  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(api.createBoard).toHaveBeenCalledWith({
      name: 'Inspiration',
      description: null,
      visibility: 'private',
      program_ids: [],
      group_ids: [],
    })
  })
  it('shows only attachable and existing restricted scopes', () => {
    setup({ ...BOARDS_FIXTURES[0], visibility: 'restricted', program_ids: [1], group_ids: [1] })
    expect(screen.getByRole('button', { name: 'Design' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Engineering' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Studio A' })).toBeInTheDocument()
  })
  it('lets an instructor remove a pre-existing out-of-scope attachment', () => {
    setup({ ...BOARDS_FIXTURES[0], visibility: 'restricted', program_ids: [2] })
    fireEvent.click(screen.getByRole('button', { name: 'Engineering' }))
    expect(screen.getByRole('button', { name: 'Save Board' })).toBeDisabled()
  })
  it('hides scope controls when forbidden', () => {
    setup({
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_change_scope: false },
    })
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()
  })
  it('does not submit scope fields when only metadata editing is allowed', async () => {
    setup({
      ...BOARDS_FIXTURES[0],
      permissions: { ...BOARDS_FIXTURES[0].permissions, can_change_scope: false },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    await waitFor(() => expect(api.updateBoard).toHaveBeenCalled())
    expect(api.updateBoard).toHaveBeenCalledWith(1, {
      name: BOARDS_FIXTURES[0].name,
      description: BOARDS_FIXTURES[0].description,
      version: 5,
    })
  })
  it('blocks a stale write until explicitly reloaded', async () => {
    vi.mocked(api.updateBoard).mockRejectedValueOnce(new api.ApiError(409, 'stale'))
    setup(BOARDS_FIXTURES[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    await screen.findByText(/This Board changed/)
    expect(screen.getByRole('button', { name: 'Save Board' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Board' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    await waitFor(() =>
      expect(api.updateBoard).toHaveBeenLastCalledWith(1, expect.objectContaining({ version: 8 })),
    )
  })
  it('surfaces validation/network errors without closing', async () => {
    vi.mocked(api.updateBoard).mockRejectedValueOnce(new api.ApiError(422, 'Board cap reached'))
    setup(BOARDS_FIXTURES[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Board cap reached')
  })
})
