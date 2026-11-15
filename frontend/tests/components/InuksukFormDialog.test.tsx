import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InuksukFormDialog from '../../src/components/InuksukFormDialog'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from '../../src/components/inuksukFixtures'
import { ApiError } from '../../src/api'

function services() {
  return {
    fetchBoards: vi.fn().mockResolvedValue([
      BOARD_FIXTURE,
      {
        ...BOARD_FIXTURE,
        id: 99,
        name: 'Read-only Board',
        permissions: { ...BOARD_FIXTURE.permissions, can_edit: false },
      },
    ]),
    fetchBoard: vi.fn().mockResolvedValue(BOARD_FIXTURE),
    createBoard: vi.fn().mockResolvedValue({
      ...BOARD_FIXTURE,
      id: 2,
      name: 'My new Board',
      sections: [],
      inuksuks: [],
    }),
    createInuksuk: vi.fn().mockResolvedValue(INUKSUK_FIXTURE),
    updateInuksuk: vi.fn().mockResolvedValue(INUKSUK_FIXTURE),
    deleteInuksuk: vi.fn().mockResolvedValue(undefined),
  }
}
const LAST_BOARD = 'hrivpref:inuksuk:lastBoard:9'
beforeEach(() => localStorage.clear())
async function setup(props: Partial<React.ComponentProps<typeof InuksukFormDialog>> = {}) {
  const api = services()
  const onChanged = vi.fn()
  const onClose = vi.fn()
  render(
    <InuksukFormDialog
      imageId={42}
      view={INUKSUK_FIXTURE}
      userId={9}
      onChanged={onChanged}
      onClose={onClose}
      services={api}
      {...props}
    />,
  )
  if (!props.item || props.item.permissions.can_edit)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Create new board' })).toBeEnabled(),
    )
  return { api, onChanged, onClose, user: userEvent.setup() }
}
describe('InuksukFormDialog', () => {
  it('requires a nonblank title and at least one editable Board, including empty lists', async () => {
    const api = services()
    api.fetchBoards.mockResolvedValue([])
    const { user } = await setup({ services: api })
    expect(screen.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
    await user.type(screen.getByLabelText('Title *'), 'A view')
    expect(screen.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Create new board' })).toBeEnabled()
  })
  it('selects only editable Boards, exposes sections, captures all form values and persists the last Board', async () => {
    const { api, user, onChanged, onClose } = await setup()
    await user.type(screen.getByLabelText('Title *'), '  Window detail  ')
    await user.type(screen.getByLabelText('Description'), '  A useful view  ')
    await user.click(screen.getByRole('combobox', { name: 'Boards' }))
    expect(screen.queryByRole('option', { name: 'Read-only Board' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Architecture inspiration' }))
    await user.click(
      await screen.findByRole('combobox', { name: 'Section in Architecture inspiration' }),
    )
    await user.click(screen.getByRole('option', { name: 'Windows' }))
    await user.click(screen.getByRole('checkbox', { name: 'Favourite' }))
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.createInuksuk).toHaveBeenCalledWith({
      x: 0.46,
      y: 0.29,
      zoom: 2.5,
      rotation: 0,
      image_id: 42,
      title: 'Window detail',
      description: 'A useful view',
      favourite: true,
      board_assignments: [{ board_id: 1, section_id: 11 }],
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(localStorage.getItem(LAST_BOARD)).toBe('1')
  })
  it("defaults to the last editable Board per user and ignores stale or another user's keys", async () => {
    localStorage.setItem(LAST_BOARD, '1')
    const { api } = await setup()
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledWith(1))
    expect(screen.getByText('Architecture inspiration')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Section in Architecture inspiration' }),
    ).toHaveTextContent('No section')
  })
  it.each(['99', 'not-json', '500'])(
    'ignores unavailable/non-editable persisted Board %s',
    async (value) => {
      localStorage.setItem(LAST_BOARD, value)
      const { api } = await setup()
      expect(api.fetchBoard).not.toHaveBeenCalled()
    },
  )
  it('does not share the last-used Board across users', async () => {
    localStorage.setItem('hrivpref:inuksuk:lastBoard:10', '1')
    const { api } = await setup()
    expect(api.fetchBoard).not.toHaveBeenCalled()
  })
  it('creates a private Board inline, selects it, and saves when it is the first Board', async () => {
    const { api, user } = await setup()
    await user.type(screen.getByLabelText('Title *'), 'New view')
    await user.click(screen.getByRole('button', { name: '+ Create new board' }))
    await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() => expect(screen.getByText('My new Board')).toBeInTheDocument())
    expect(api.createBoard).toHaveBeenCalledWith({ name: 'My new Board', visibility: 'private' })
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    await waitFor(() =>
      expect(api.createInuksuk).toHaveBeenCalledWith(
        expect.objectContaining({ board_assignments: [{ board_id: 2, section_id: null }] }),
      ),
    )
  })
  it('supports multiple Boards and preserves the existing per-Board section on edit', async () => {
    const { api, user } = await setup({ item: INUKSUK_FIXTURE })
    expect(
      screen.getByRole('combobox', { name: 'Section in Architecture inspiration' }),
    ).toHaveTextContent('Windows')
    await user.click(screen.getByRole('button', { name: '+ Create new board' }))
    await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() => expect(screen.getByText('My new Board')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          version: 3,
          board_assignments: [
            { board_id: 1, section_id: 11 },
            { board_id: 2, section_id: null },
          ],
        }),
      ),
    )
  })
  it('surfaces OCC conflict without discarding edits, then reloads the current projection and retries its version', async () => {
    const { api, user, onChanged } = await setup({ item: INUKSUK_FIXTURE })
    api.updateInuksuk.mockRejectedValueOnce(
      new ApiError(409, 'stale', { ...INUKSUK_FIXTURE, title: 'Server title', version: 4 }),
    )
    await user.clear(screen.getByLabelText('Title *'))
    await user.type(screen.getByLabelText('Title *'), 'Local edit')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed since you opened it')
    expect(screen.getByLabelText('Title *')).toHaveValue('Local edit')
    expect(onChanged).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reload current' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled())
    expect(screen.getByLabelText('Title *')).toHaveValue('Server title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ title: 'Server title', version: 4 }),
      ),
    )
  })
  it('requires confirmation before an OCC-protected delete and refetches after success', async () => {
    const { api, user, onChanged } = await setup({ item: INUKSUK_FIXTURE })
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.deleteInuksuk).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.deleteInuksuk).toHaveBeenCalledWith(7, 3))
    expect(onChanged).toHaveBeenCalledOnce()
  })
  it('hides edit/delete controls when permissions deny them', async () => {
    await setup({
      item: { ...INUKSUK_FIXTURE, permissions: { can_edit: false, can_delete: false } },
    })
    expect(screen.getByLabelText('Title *')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Save|Delete/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })
  it('surfaces Board load, inline-create and save errors without closing', async () => {
    const api = services()
    api.fetchBoards.mockRejectedValue(new ApiError(403, 'Cannot load Boards'))
    const { user, onClose } = await setup({ services: api })
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load Boards')
    await user.click(screen.getByRole('button', { name: '+ Create new board' }))
    await user.type(screen.getByLabelText('New private Board name'), 'Test Board')
    api.createBoard.mockRejectedValueOnce(new ApiError(422, 'Board limit reached'))
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Board limit reached')
    api.createBoard.mockResolvedValueOnce(BOARD_FIXTURE)
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await user.type(screen.getByLabelText('Title *'), 'A view')
    api.createInuksuk.mockRejectedValueOnce(new ApiError(422, 'Inuksuk limit reached'))
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Inuksuk limit reached')
    expect(onClose).not.toHaveBeenCalled()
  })
})
