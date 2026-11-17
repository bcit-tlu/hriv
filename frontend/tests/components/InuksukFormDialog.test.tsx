import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Boards' })).toBeEnabled())
  return { api, onChanged, onClose, user: userEvent.setup() }
}
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '+ Create new board' }))
}
describe('InuksukFormDialog', () => {
  it.each([null, INUKSUK_FIXTURE.description])(
    'keeps inline description collapsed and preserves its value, description=%s',
    async (description) => {
      const { user, api } = await setup({ inline: true, item: { ...INUKSUK_FIXTURE, description } })
      expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: INUKSUK_FIXTURE.title }).previousElementSibling,
      ).toHaveAttribute('data-testid', 'CompassCalibrationIcon')
      await user.click(screen.getByRole('button', { name: 'More options' }))
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(description ?? '')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.updateInuksuk).toHaveBeenCalledWith(7, expect.objectContaining({ description }))
    },
  )
  it('cancels secondary delete confirmation without losing the inline draft, and retains deletion errors there', async () => {
    const { user, api, onClose } = await setup({ inline: true, item: INUKSUK_FIXTURE })
    await user.clear(screen.getByRole('textbox', { name: /^Title/ }))
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Unsaved title')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete Inuksuk?' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveValue('Unsaved title')
    expect(onClose).not.toHaveBeenCalled()
    api.deleteInuksuk.mockRejectedValueOnce(new ApiError(403, 'Delete denied'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Inuksuk?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Delete denied')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('sorts checkbox options alphabetically, keeps chip-free selected text and creates Boards outside the menu', async () => {
    const api = services()
    api.fetchBoards.mockResolvedValue(
      ['zeta', 'beta', 'Alpha'].map((name, index) => ({ ...BOARD_FIXTURE, id: index + 1, name })),
    )
    api.fetchBoard.mockImplementation(async (id: number) => ({ ...BOARD_FIXTURE, id }))
    const { user } = await setup({ services: api })
    const field = screen.getByRole('combobox', { name: 'Boards' })
    await user.click(field)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Alpha',
      'beta',
      'zeta',
    ])
    for (const name of ['Alpha', 'beta', 'zeta'])
      await user.click(screen.getByRole('option', { name }))
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(3)
    await user.keyboard('{Escape}')
    expect(screen.getByText('zeta, beta +1')).toBeVisible()
    expect(field).toHaveAccessibleDescription(/zeta, beta \+1/)
    expect(document.querySelector('.MuiAutocomplete-tag')).toBeNull()
    await user.click(field)
    await user.type(field, 'My new Board')
    expect(screen.queryByRole('option')).toBeNull()
    await user.keyboard('{Escape}')
    await openCreate(user)
    await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith({ name: 'My new Board', visibility: 'private' }),
    )
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await user.click(screen.getByRole('button', { name: 'Favourite' }))
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('checkbox', { name: 'Favourite' })).toBeNull()
  })
  it('places in a non-modal panel with a selected title, remembered Board and collapsed optional fields', async () => {
    localStorage.setItem(LAST_BOARD, '1')
    const { user, api } = await setup({ placement: true })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
    const title = screen.getByRole('textbox', { name: /^Title/ }) as HTMLInputElement
    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe(title.value.length)
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Favourite' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.type(screen.getByLabelText('Description'), 'A saved detail')
    await user.click(screen.getByRole('button', { name: 'Favourite' }))
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(api.createInuksuk).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Inuksuk',
        description: 'A saved detail',
        favourite: true,
        board_assignments: [{ board_id: 1 }],
      }),
    )
  })
  it.each(['list', 'details'])(
    'blocks edits after Board %s loading fails, even after creating a Board inline',
    async (failure) => {
      const api = services()
      if (failure === 'list') api.fetchBoards.mockRejectedValue(new Error('offline'))
      else api.fetchBoard.mockRejectedValue(new Error('offline'))
      const { user, onClose, onChanged } = await setup({ services: api, item: INUKSUK_FIXTURE })
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await openCreate(user)
      await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
      await user.click(screen.getByRole('button', { name: 'Create Board' }))
      await waitFor(() => expect(screen.getByText(/My new Board/)).toBeVisible())
      expect(screen.getByText(/Existing Board assignments could not be loaded/)).toBeInTheDocument()
      const save = screen.getByRole('button', { name: 'Save changes' })
      expect(save).toBeDisabled()
      fireEvent.click(save)
      expect(api.updateInuksuk).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    },
  )
  it('requires a nonblank title and at least one editable Board, including empty lists', async () => {
    const api = services()
    api.fetchBoards.mockResolvedValue([])
    const { user } = await setup({ services: api })
    expect(screen.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
    await user.type(screen.getByLabelText('Title *'), 'A view')
    expect(screen.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
    await openCreate(user)
    expect(screen.getByLabelText('New private Board name')).toHaveFocus()
  })
  it('selects only editable Boards, captures all form values and persists the last Board', async () => {
    const { api, user, onChanged, onClose } = await setup()
    await user.type(screen.getByLabelText('Title *'), '  Window detail  ')
    await user.type(screen.getByLabelText('Description'), '  A useful view  ')
    await user.click(screen.getByRole('combobox', { name: 'Boards' }))
    expect(screen.queryByRole('option', { name: 'Read-only Board' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Architecture inspiration' }))
    await user.click(screen.getByRole('button', { name: 'Favourite' }))
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
      board_assignments: [{ board_id: 1 }],
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledWith(INUKSUK_FIXTURE)
    expect(localStorage.getItem(LAST_BOARD)).toBe('1')
  })
  it("defaults to the last editable Board per user and ignores stale or another user's keys", async () => {
    localStorage.setItem(LAST_BOARD, '1')
    const { api } = await setup()
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledWith(1))
    expect(screen.getByText('Architecture inspiration')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Boards' })).toHaveAccessibleDescription(
      /Architecture inspiration/,
    )
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
    await openCreate(user)
    await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() => expect(screen.getByText('My new Board')).toBeVisible())
    expect(api.createBoard).toHaveBeenCalledWith({ name: 'My new Board', visibility: 'private' })
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    await waitFor(() =>
      expect(api.createInuksuk).toHaveBeenCalledWith(
        expect.objectContaining({ board_assignments: [{ board_id: 2 }] }),
      ),
    )
  })
  it('supports multiple Boards and preserves existing Board assignments on edit', async () => {
    const { api, user } = await setup({ item: INUKSUK_FIXTURE })
    await openCreate(user)
    await user.type(screen.getByLabelText('New private Board name'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() =>
      expect(screen.getByText('Architecture inspiration, My new Board')).toBeVisible(),
    )
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.updateInuksuk).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          version: 3,
          board_assignments: [{ board_id: 1 }, { board_id: 2 }],
        }),
      ),
    )
  })
  it.each([false, true])(
    'surfaces OCC conflict and reloads the current version, inline=%s',
    async (inline) => {
      const { api, user, onChanged } = await setup({ item: INUKSUK_FIXTURE, inline })
      api.updateInuksuk.mockRejectedValueOnce(
        new ApiError(409, 'stale', { ...INUKSUK_FIXTURE, title: 'Server title', version: 4 }),
      )
      await user.clear(screen.getByLabelText('Title *'))
      await user.type(screen.getByLabelText('Title *'), 'Local edit')
      await user.click(screen.getByRole('button', { name: inline ? 'Save' : 'Save changes' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('changed since you opened it')
      expect(screen.getByLabelText('Title *')).toHaveValue('Local edit')
      expect(onChanged).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Reload current' }))
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: inline ? 'Save' : 'Save changes' }),
        ).toBeEnabled(),
      )
      expect(screen.getByLabelText('Title *')).toHaveValue('Server title')
      await user.click(screen.getByRole('button', { name: inline ? 'Save' : 'Save changes' }))
      await waitFor(() =>
        expect(api.updateInuksuk).toHaveBeenLastCalledWith(
          7,
          expect.objectContaining({ title: 'Server title', version: 4 }),
        ),
      )
    },
  )
  it.each([false, true])(
    'requires confirmation before an OCC-protected delete, inline=%s',
    async (inline) => {
      const { api, user, onChanged } = await setup({ item: INUKSUK_FIXTURE, inline })
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      expect(api.deleteInuksuk).not.toHaveBeenCalled()
      const confirmation = screen.getByRole('dialog', { name: 'Delete Inuksuk?' })
      expect(
        within(confirmation).getByText(/permanently deleted from all its Boards/),
      ).toBeVisible()
      await user.click(within(confirmation).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(api.deleteInuksuk).toHaveBeenCalledWith(7, 3))
      expect(onChanged).toHaveBeenCalledOnce()
    },
  )
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
    await openCreate(user)
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
