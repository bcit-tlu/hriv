import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import BoardOwnersDialog from '../../src/components/BoardOwnersDialog'
import { BOARD_AUTH, BOARD_PROGRAMS, BOARDS_FIXTURES } from '../../src/components/boardsFixtures'
vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchUsersPaged: vi.fn(),
  replaceBoardOwners: vi.fn(),
  transferBoard: vi.fn(),
  fetchBoard: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchUsersPaged).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(api.transferBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.replaceBoardOwners).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.fetchBoard).mockResolvedValue({ ...BOARDS_FIXTURES[0], version: 7 })
})
function setup(board = BOARDS_FIXTURES[0]) {
  render(
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardOwnersDialog
        board={board}
        programs={BOARD_PROGRAMS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </AuthContext.Provider>,
  )
}
describe('BoardOwnersDialog', () => {
  it('renders mapped user owners and blocks removing the final owner', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'select Alex' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Alex' }))
    expect(screen.getByRole('button', { name: 'Change Owner(s)' })).toBeDisabled()
  })
  it('narrows transfer programs and sends the Board version', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Program' }))
    expect(screen.queryByTestId('program-choice-2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('program-choice-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Change Owner' }))
    await waitFor(() =>
      expect(api.transferBoard).toHaveBeenCalledWith(1, { version: 5, program_id: 1 }),
    )
  })
  it('offers explicit reload on a stale ownership change', async () => {
    vi.mocked(api.transferBoard).mockRejectedValueOnce(new api.ApiError(409, 'stale'))
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Program' }))
    fireEvent.click(screen.getByTestId('program-choice-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Change Owner' }))
    await screen.findByText(/Ownership changed/)
    expect(screen.getByRole('button', { name: 'Change Owner' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'User' })).toBeChecked())
  })
  it('shows program ownership and prevents an orphaning clear', () => {
    setup({
      ...BOARDS_FIXTURES[0],
      owner_program_id: 1,
      owners: [{ user_id: null, program_id: 1, name: 'Design', role: null }],
    })
    expect(screen.getByRole('radio', { name: 'Program' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Change Owner' })).toBeDisabled()
  })
})
