import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../src/authContextValue'
import MarkerFormDialog from '../../src/components/MarkerFormDialog'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../../src/components/markerFixtures'
import { BOARD_AUTH } from '../../src/components/boardsFixtures'
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

      markers: [],
    }),
    fetchPrograms: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Design',
        oidc_group: null,
        created_at: MARKER_FIXTURE.created_at,
        updated_at: MARKER_FIXTURE.updated_at,
      },
      {
        id: 2,
        name: 'Engineering',
        oidc_group: null,
        created_at: MARKER_FIXTURE.created_at,
        updated_at: MARKER_FIXTURE.updated_at,
      },
    ]),
    fetchGroups: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Studio A',
        description: null,
        created_by_user_id: 9,
        member_ids: [],
        instructor_ids: [9],
        created_at: MARKER_FIXTURE.created_at,
        updated_at: MARKER_FIXTURE.updated_at,
      },
    ]),
    createMarker: vi.fn().mockResolvedValue(MARKER_FIXTURE),
    updateMarker: vi.fn().mockResolvedValue(MARKER_FIXTURE),
    deleteMarker: vi.fn().mockResolvedValue(undefined),
  }
}
const LAST_BOARD = 'hrivpref:marker:lastBoard:9'
beforeEach(() => localStorage.clear())
async function setup(props: Partial<React.ComponentProps<typeof MarkerFormDialog>> = {}) {
  const api = services()
  const onChanged = vi.fn()
  const onClose = vi.fn()
  render(
    <AuthContext.Provider value={BOARD_AUTH}>
      <MarkerFormDialog
        imageId={42}
        view={MARKER_FIXTURE}
        userId={9}
        onChanged={onChanged}
        onClose={onClose}
        services={api}
        {...props}
      />
    </AuthContext.Provider>,
  )
  if (!props.item || props.item.permissions.can_edit)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Boards' })).toBeEnabled())
  return { api, onChanged, onClose, user: userEvent.setup() }
}
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Boards' }))
  await user.click(screen.getByRole('button', { name: 'New Board' }))
}
describe('MarkerFormDialog', () => {
  it.each([null, MARKER_FIXTURE.description])(
    'shows the inline description and preserves its value, description=%s',
    async (description) => {
      const { user, api } = await setup({ inline: true, item: { ...MARKER_FIXTURE, description } })
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(description ?? '')
      expect(
        screen.getByRole('heading', { name: MARKER_FIXTURE.title }).previousElementSibling,
      ).toHaveAttribute('data-testid', 'RoomIcon')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.updateMarker).toHaveBeenCalledWith(7, expect.objectContaining({ description }))
    },
  )
  it('cancels secondary delete confirmation without losing the inline draft, and retains deletion errors there', async () => {
    const { user, api, onClose } = await setup({ inline: true, item: MARKER_FIXTURE })
    await user.clear(screen.getByRole('textbox', { name: /^Title/ }))
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Unsaved title')
    await user.click(screen.getByRole('button', { name: 'Delete Marker' }))
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete Marker?' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveValue('Unsaved title')
    expect(onClose).not.toHaveBeenCalled()
    api.deleteMarker.mockRejectedValueOnce(new ApiError(403, 'Delete denied'))
    await user.click(screen.getByRole('button', { name: 'Delete Marker' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Marker?' })
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
    expect(screen.getByRole('button', { name: 'New Board' })).toBeVisible()
    await openCreate(user)
    await user.type(screen.getByLabelText('Name *'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My new Board', visibility: 'private' }),
      ),
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
  it('places in a non-modal panel with a selected title, remembered Board and standard chrome', async () => {
    localStorage.setItem(LAST_BOARD, '1')
    const { user, api } = await setup({ placement: true })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
    const title = screen.getByRole('textbox', { name: /^Title/ }) as HTMLInputElement
    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe(title.value.length)
    // The popover follows the standalone dialog's layout — Description is
    // always visible, no collapsed "More options" section.
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Favourite' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Description'), 'A saved detail')
    await user.click(screen.getByRole('button', { name: 'Favourite' }))
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(api.createMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Marker',
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
      const { user, onClose, onChanged } = await setup({ services: api, item: MARKER_FIXTURE })
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await openCreate(user)
      await user.type(screen.getByLabelText('Name *'), 'My new Board')
      await user.click(screen.getByRole('button', { name: 'Create Board' }))
      await waitFor(() => expect(screen.getByText(/My new Board/)).toBeVisible())
      expect(screen.getByText(/Existing Board assignments could not be loaded/)).toBeInTheDocument()
      const save = screen.getByRole('button', { name: 'Save changes' })
      expect(save).toBeDisabled()
      fireEvent.click(save)
      expect(api.updateMarker).not.toHaveBeenCalled()
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
    expect(screen.getByLabelText('Name *')).toHaveFocus()
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
    expect(api.createMarker).toHaveBeenCalledWith({
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
    expect(onChanged).toHaveBeenCalledWith(MARKER_FIXTURE)
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
    localStorage.setItem('hrivpref:marker:lastBoard:10', '1')
    const { api } = await setup()
    expect(api.fetchBoard).not.toHaveBeenCalled()
  })
  it('creates a private Board inline, selects it, and saves when it is the first Board', async () => {
    const { api, user } = await setup()
    await user.type(screen.getByLabelText('Title *'), 'New view')
    await openCreate(user)
    await user.type(screen.getByLabelText('Name *'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() => expect(screen.getByText('My new Board')).toBeVisible())
    expect(api.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My new Board', visibility: 'private' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    await waitFor(() =>
      expect(api.createMarker).toHaveBeenCalledWith(
        expect.objectContaining({ board_assignments: [{ board_id: 2 }] }),
      ),
    )
  })
  it('supports multiple Boards and preserves existing Board assignments on edit', async () => {
    const { api, user } = await setup({ item: MARKER_FIXTURE })
    await openCreate(user)
    await user.type(screen.getByLabelText('Name *'), 'My new Board')
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() =>
      expect(screen.getByText('Architecture inspiration, My new Board')).toBeVisible(),
    )
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.updateMarker).toHaveBeenCalledWith(
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
      const { api, user, onChanged } = await setup({ item: MARKER_FIXTURE, inline })
      api.updateMarker.mockRejectedValueOnce(
        new ApiError(409, 'stale', { ...MARKER_FIXTURE, title: 'Server title', version: 4 }),
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
        expect(api.updateMarker).toHaveBeenLastCalledWith(
          7,
          expect.objectContaining({ title: 'Server title', version: 4 }),
        ),
      )
    },
  )
  it.each([false, true])(
    'requires confirmation before an OCC-protected delete, inline=%s',
    async (inline) => {
      const { api, user, onChanged } = await setup({ item: MARKER_FIXTURE, inline })
      await user.click(screen.getByRole('button', { name: 'Delete Marker' }))
      expect(api.deleteMarker).not.toHaveBeenCalled()
      const confirmation = screen.getByRole('dialog', { name: 'Delete Marker?' })
      expect(
        within(confirmation).getByText(/permanently deleted from all its Boards/),
      ).toBeVisible()
      await user.click(within(confirmation).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(api.deleteMarker).toHaveBeenCalledWith(7, 3))
      expect(onChanged).toHaveBeenCalledOnce()
    },
  )
  it('hides edit/delete controls when permissions deny them', async () => {
    await setup({
      item: { ...MARKER_FIXTURE, permissions: { can_edit: false, can_delete: false } },
    })
    expect(screen.getByLabelText('Title *')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Save|Delete/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })
  it('pins New Board at the bottom of the Boards menu outside the scrollable listbox', async () => {
    const { user } = await setup()
    const field = screen.getByRole('combobox', { name: 'Boards' })
    await user.click(field)
    const listbox = screen.getByRole('listbox')
    const add = screen.getByRole('button', { name: 'New Board' })
    expect(add).toBeVisible()
    expect(within(listbox).queryByText('New Board')).toBeNull()
    await user.type(field, 'zzz')
    expect(screen.queryByRole('option')).toBeNull()
    // Emptying the options inserts a "no options" node that remounts the
    // pinned footer, so re-query rather than reusing the earlier element.
    expect(screen.getByRole('button', { name: 'New Board' })).toBeVisible()
  })
  it('opens the Add Board pane over the form, returns via back or Escape, and keeps the draft', async () => {
    const { user, onClose } = await setup()
    await user.type(screen.getByLabelText('Title *'), 'Draft title')
    await openCreate(user)
    expect(screen.getByRole('heading', { name: 'New Board' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /^Title/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back to Marker' }))
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveValue('Draft title')
    await openCreate(user)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveValue('Draft title')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('loads Program and Group chips lazily for restricted Boards and requires one of each scope', async () => {
    const { api, user } = await setup()
    expect(api.fetchPrograms).not.toHaveBeenCalled()
    expect(api.fetchGroups).not.toHaveBeenCalled()
    await openCreate(user)
    await user.click(screen.getByRole('radio', { name: /^Restricted/ }))
    await waitFor(() => expect(api.fetchPrograms).toHaveBeenCalledOnce())
    expect(api.fetchGroups).toHaveBeenCalledOnce()
    await user.type(screen.getByLabelText('Name *'), 'Studio Board')
    const create = screen.getByRole('button', { name: 'Create Board' })
    expect(create).toBeDisabled()
    const program = await screen.findByRole('button', { name: 'Design' })
    expect(screen.queryByRole('button', { name: 'Engineering' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Studio A' }))
    expect(create).toBeEnabled()
    await user.click(program)
    await user.click(create)
    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'restricted',
          program_ids: [1],
          group_ids: [1],
        }),
      ),
    )
  })
  it('surfaces Board load, inline-create and save errors without closing', async () => {
    const api = services()
    api.fetchBoards.mockRejectedValue(new ApiError(403, 'Cannot load Boards'))
    const { user, onClose } = await setup({ services: api })
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load Boards')
    await openCreate(user)
    await user.type(screen.getByLabelText('Name *'), 'Test Board')
    api.createBoard.mockRejectedValueOnce(new ApiError(422, 'Board limit reached'))
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Board limit reached')
    api.createBoard.mockResolvedValueOnce(BOARD_FIXTURE)
    await user.click(screen.getByRole('button', { name: 'Create Board' }))
    await waitFor(() => expect(screen.getByLabelText('Title *')).toBeVisible())
    await user.type(screen.getByLabelText('Title *'), 'A view')
    api.createMarker.mockRejectedValueOnce(new ApiError(422, 'Marker limit reached'))
    await user.click(screen.getByRole('button', { name: 'Save to Board' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Marker limit reached')
    expect(onClose).not.toHaveBeenCalled()
  })
})
