import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectionOwnersDialog from '../../src/components/CollectionOwnersDialog'
import type { CollectionOwnersDialogProps } from '../../src/components/CollectionOwnersDialog'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import { ApiError, fetchUsersPaged } from '../../src/api'
import type { Role, User } from '../../src/types'
import { makeCollectionSummary } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return { ...actual, fetchUsersPaged: vi.fn() }
})

const fetchUsersPagedMock = vi.mocked(fetchUsersPaged)

function makeAuth(role: Role, id = 7, program_ids: number[] = []): AuthContextValue {
  return {
    currentUser: {
      id,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role,
      active: true,
      program_ids,
      program_names: [],
      group_ids: [],
      group_names: [],
    } as User,
    users: [],
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    addUser: vi.fn(),
    deleteUser: vi.fn(),
    refreshUsers: vi.fn(),
    canManageUsers: role === 'admin',
    canEditContent: role === 'admin' || role === 'instructor',
    canViewPeople: role !== 'student',
    oidcError: null,
    clearOidcError: vi.fn(),
  } as unknown as AuthContextValue
}

const PROGRAMS = [
  { id: 1, name: 'Radiography' },
  { id: 2, name: 'Ultrasound' },
] as CollectionOwnersDialogProps['programs']

const OWNED = makeCollectionSummary({ id: 1, name: 'Skull comparison' })
const CO_OWNED = makeCollectionSummary({
  id: 2,
  name: 'Shared set',
  owners: [
    { kind: 'user', userId: 7, name: 'Ada Lovelace' },
    { kind: 'user', userId: 9, name: 'Grace Hopper' },
  ],
})
const ORPHANED = makeCollectionSummary({ id: 5, name: 'Legacy set', owners: [] })
const PROGRAM_OWNED = makeCollectionSummary({
  id: 6,
  name: 'Program set',
  owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
})

function renderDialog(
  overrides: Partial<CollectionOwnersDialogProps> = {},
  auth: AuthContextValue = makeAuth('admin'),
) {
  const props: CollectionOwnersDialogProps = {
    open: true,
    onClose: vi.fn(),
    collection: OWNED,
    programs: PROGRAMS,
    onSaveOwners: vi.fn().mockResolvedValue(undefined),
    onTransfer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(
    <AuthContext.Provider value={auth}>
      <CollectionOwnersDialog {...props} />
    </AuthContext.Provider>,
  )
  return props
}

/** Pick `name` from the owners autocomplete's listbox. */
async function pickUser(user: ReturnType<typeof userEvent.setup>, name: string) {
  const input = screen.getByLabelText('User owners')
  await user.click(input)
  await user.type(input, name)
  const option = await screen.findByRole('option', { name: new RegExp(name) })
  await user.click(option)
}

describe('CollectionOwnersDialog (#1531)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUsersPagedMock.mockResolvedValue({
      items: [
        {
          id: 9,
          name: 'Grace Hopper',
          email: 'grace@example.com',
          role: 'instructor',
          active: true,
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
          metadata_extra: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 10,
          name: 'Inactive Ian',
          email: 'ian@example.com',
          role: 'instructor',
          active: false,
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
          metadata_extra: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      total: 2,
    })
  })

  it('renders the current user owners and program owner', () => {
    renderDialog({ collection: CO_OWNED })
    expect(screen.getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace, Grace Hopper/)).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument() // selected chip
  })

  it('keeps Save disabled until something changes', () => {
    renderDialog()
    expect(screen.getByTestId('owners-confirm')).toBeDisabled()
  })

  it('adds a co-owner via the user picker and PUTs the full set', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await pickUser(user, 'Grace Hopper')
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onSaveOwners).toHaveBeenCalledWith(1, [7, 9]))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('removes a co-owner via the chip delete affordance', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ collection: CO_OWNED })
    // Each selected owner renders a removable MUI Chip (CancelIcon = delete).
    await user.click(screen.getAllByTestId('CancelIcon')[1])
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onSaveOwners).toHaveBeenCalledWith(2, [7]))
  })

  it('never offers inactive users in the picker', async () => {
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText('User owners')
    await user.click(input)
    await screen.findByRole('option', { name: /Grace Hopper/ })
    expect(screen.queryByRole('option', { name: /Inactive Ian/ })).not.toBeInTheDocument()
  })

  it('blocks saving an empty owner set with no program (orphan guard)', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByTestId('CancelIcon'))
    // No program owner and no user owners → the dialog must not even try.
    expect(screen.getByTestId('owners-confirm')).toBeDisabled()
  })

  it('assigning a program owner calls transfer and skips the owners PUT', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: 'Ultrasound' }))
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onTransfer).toHaveBeenCalledWith(1, 2))
    expect(props.onSaveOwners).not.toHaveBeenCalled()
  })

  it('disables the user picker while a program is being assigned', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: 'Ultrasound' }))
    expect(screen.getByLabelText('User owners')).toBeDisabled()
  })

  it('saves new user owners before clearing the program owner', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const onSaveOwners = vi.fn(async () => {
      order.push('owners')
    })
    const onTransfer = vi.fn(async () => {
      order.push('transfer')
    })
    renderDialog({ collection: PROGRAM_OWNED, onSaveOwners, onTransfer })
    // Clearing the program requires at least one user owner — add one first.
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: /None — owned by users/ }))
    await pickUser(user, 'Grace Hopper')
    await user.click(screen.getByTestId('owners-confirm'))
    // Owners must land before the program clears so the row is never orphaned.
    await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(6, null))
    expect(onSaveOwners).toHaveBeenCalledWith(6, [9])
    expect(order).toEqual(['owners', 'transfer'])
  })

  it('stages co-owners alongside an unchanged program owner', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ collection: PROGRAM_OWNED })
    // Clear the program to unlock the picker, add a co-owner, then reselect
    // the same program — the PUT must still run (regression: this used to
    // silently discard the edit when the program value round-tripped).
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: /None — owned by users/ }))
    await pickUser(user, 'Grace Hopper')
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: 'Radiography' }))
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onSaveOwners).toHaveBeenCalledWith(6, [9]))
    // The program never changed, so no transfer runs.
    expect(props.onTransfer).not.toHaveBeenCalled()
  })

  it('narrows the program list to the instructor’s own programs', async () => {
    const user = userEvent.setup()
    renderDialog({}, makeAuth('instructor', 7, [2]))
    await user.click(screen.getByLabelText('Owning program'))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('Ultrasound')).toBeInTheDocument()
    expect(within(listbox).queryByText('Radiography')).not.toBeInTheDocument()
  })

  it('surfaces a stale-version 409 inside the dialog', async () => {
    const user = userEvent.setup()
    const onSaveOwners = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'Stale version', { version: 9 }))
    renderDialog({ collection: CO_OWNED, onSaveOwners })
    await user.click(screen.getAllByTestId('CancelIcon')[1])
    await user.click(screen.getByTestId('owners-confirm'))
    expect(await screen.findByTestId('owners-error')).toHaveTextContent(/Stale version/)
    // The dialog stays open so the admin can retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('surfaces the orphan-guard 422 inside the dialog', async () => {
    const user = userEvent.setup()
    const onTransfer = vi
      .fn()
      .mockRejectedValue(new ApiError(422, 'A collection must keep at least one owner'))
    renderDialog({ collection: PROGRAM_OWNED, onTransfer })
    await user.click(screen.getByLabelText('Owning program'))
    await user.click(await screen.findByRole('option', { name: /None — owned by users/ }))
    await pickUser(user, 'Grace Hopper')
    await user.click(screen.getByTestId('owners-confirm'))
    expect(await screen.findByTestId('owners-error')).toHaveTextContent(/at least one owner/)
  })

  it('shows the orphaned hint for ownerless collections', () => {
    renderDialog({ collection: ORPHANED })
    expect(screen.getByText(/This collection is orphaned/)).toBeInTheDocument()
  })
})
