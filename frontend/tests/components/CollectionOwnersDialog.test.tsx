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

const DIRECTORY_USERS = [
  {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
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
    id: 9,
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'instructor',
    active: true,
    program_ids: [1],
    program_names: ['Radiography'],
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
]

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

/** Switch to the User pane and check `name`'s row. */
async function pickUser(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('checkbox', { name: `select ${name}` }))
}

describe('CollectionOwnersDialog (#1531)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUsersPagedMock.mockResolvedValue({ items: DIRECTORY_USERS, total: 2 })
  })

  it('renders the current owners and a Program/User radio row', () => {
    renderDialog({ collection: CO_OWNED })
    expect(screen.getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace, Grace Hopper/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Program' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'User' })).toBeChecked()
  })

  it('keeps the confirm disabled until something changes', () => {
    renderDialog()
    expect(screen.getByTestId('owners-confirm')).toBeDisabled()
  })

  it('checks staged users in the table and PUTs the full set', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await pickUser(user, 'Grace Hopper')
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onSaveOwners).toHaveBeenCalledWith(1, [7, 9]))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('unchecking a current owner drops them from the PUT set', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ collection: CO_OWNED })
    // Grace Hopper is a current owner — she starts checked.
    const row = (await screen.findByText('Grace Hopper')).closest('tr')!
    expect(within(row).getByRole('checkbox')).toBeChecked()
    await user.click(within(row).getByRole('checkbox'))
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onSaveOwners).toHaveBeenCalledWith(2, [7]))
  })

  it('never lists inactive users in the table', async () => {
    renderDialog()
    await screen.findByText('Grace Hopper')
    expect(screen.queryByText('Inactive Ian')).not.toBeInTheDocument()
  })

  it('defaults admin searches to the Everyone scope (no role param)', async () => {
    renderDialog()
    await waitFor(() => expect(fetchUsersPagedMock).toHaveBeenCalled())
    expect(fetchUsersPagedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: undefined }),
    )
  })

  it('scopes instructor searches like the group picker via the Role filter', async () => {
    const user = userEvent.setup()
    renderDialog({}, makeAuth('instructor', 7, [1]))
    await waitFor(() => expect(fetchUsersPagedMock).toHaveBeenCalled())
    // Same default as the group member picker: the students scope.
    expect(fetchUsersPagedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'student', programIds: undefined }),
    )
    await user.click(screen.getByRole('button', { name: 'Role' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Instructors' }))
    await waitFor(() =>
      expect(fetchUsersPagedMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'instructor' }),
      ),
    )
    // Instructors never see the Everyone option — the role-scoped endpoint
    // enforces the same boundary for admins/staff.
    expect(screen.queryByRole('menuitemradio', { name: 'Everyone' })).not.toBeInTheDocument()
  })

  it('narrows only the student search by the optional program filter', async () => {
    const user = userEvent.setup()
    renderDialog({}, makeAuth('instructor', 7, [1]))
    await waitFor(() => expect(fetchUsersPagedMock).toHaveBeenCalled())
    // Program narrowing is offered only in the Students scope (group parity).
    await user.click(screen.getByRole('button', { name: 'Program' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Radiography' }))
    await waitFor(() =>
      expect(fetchUsersPagedMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'student', programIds: [1] }),
      ),
    )
    // Switching to Instructors hides the button and ignores the filter.
    await user.click(screen.getByRole('button', { name: 'Role' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Instructors' }))
    expect(screen.queryByRole('button', { name: 'Program' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetchUsersPagedMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'instructor', programIds: undefined }),
      ),
    )
  })

  it('blocks saving an empty owner set with no program (orphan guard)', async () => {
    const user = userEvent.setup()
    renderDialog()
    // Ada is the only current owner — unchecking her leaves an empty set.
    const adaRow = (await screen.findAllByText('Ada Lovelace'))
      .map((el) => el.closest('tr'))
      .find((tr): tr is HTMLTableRowElement => tr != null)!
    await user.click(within(adaRow).getByRole('checkbox'))
    // No program owner and no user owners → the dialog must not even try.
    expect(screen.getByTestId('owners-confirm')).toBeDisabled()
  })

  it('opens on the Program pane for a program-owned collection', async () => {
    renderDialog({ collection: PROGRAM_OWNED })
    expect(screen.getByRole('radio', { name: 'Program' })).toBeChecked()
    // The owning program renders as the filled, deletable chip.
    const chip = screen.getByTestId('program-choice-1')
    expect(chip).toHaveClass('MuiChip-filled')
    expect(within(chip).getByTestId('CancelIcon')).toBeInTheDocument()
  })

  it('selects a program chip and transfers ownership', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('radio', { name: 'Program' }))
    await user.click(screen.getByTestId('program-choice-2'))
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(props.onTransfer).toHaveBeenCalledWith(1, 2))
    expect(props.onSaveOwners).not.toHaveBeenCalled()
  })

  it('chip delete reverts to outlined and only one chip can be active', async () => {
    const user = userEvent.setup()
    renderDialog({ collection: PROGRAM_OWNED })
    // Radiography starts active; picking Ultrasound swaps the selection.
    await user.click(screen.getByTestId('program-choice-2'))
    expect(screen.getByTestId('program-choice-2')).toHaveClass('MuiChip-filled')
    expect(screen.getByTestId('program-choice-1')).toHaveClass('MuiChip-outlined')
    // The delete icon on the active chip reverts it to outlined.
    await user.click(within(screen.getByTestId('program-choice-2')).getByTestId('CancelIcon'))
    expect(screen.getByTestId('program-choice-2')).toHaveClass('MuiChip-outlined')
  })

  it('narrows the program chips to the instructor’s own programs', async () => {
    const user = userEvent.setup()
    renderDialog({}, makeAuth('instructor', 7, [2]))
    await user.click(screen.getByRole('radio', { name: 'Program' }))
    expect(screen.getByTestId('program-choice-2')).toBeInTheDocument()
    expect(screen.queryByTestId('program-choice-1')).not.toBeInTheDocument()
  })

  it('surfaces a stale-version 409 inside the dialog', async () => {
    const user = userEvent.setup()
    const onSaveOwners = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'Stale version', { version: 9 }))
    renderDialog({ collection: CO_OWNED, onSaveOwners })
    const row = (await screen.findByText('Grace Hopper')).closest('tr')!
    await user.click(within(row).getByRole('checkbox'))
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
    // Program-owned with user co-owners so the chip delete stays legal.
    const both = makeCollectionSummary({
      id: 8,
      name: 'Mixed set',
      owners: [
        { kind: 'program', programId: 1, name: 'Radiography' },
        { kind: 'user', userId: 7, name: 'Ada Lovelace' },
      ],
    })
    renderDialog({ collection: both, onTransfer })
    // Deselect the only chip → "no program owner" → transfer(null).
    await user.click(
      within(await screen.findByTestId('program-choice-1')).getByTestId('CancelIcon'),
    )
    await user.click(screen.getByTestId('owners-confirm'))
    await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(8, null))
    expect(await screen.findByTestId('owners-error')).toHaveTextContent(/at least one owner/)
  })

  it('shows the orphaned hint for ownerless collections', () => {
    renderDialog({ collection: ORPHANED })
    expect(screen.getByText(/This collection is orphaned/)).toBeInTheDocument()
  })
})
