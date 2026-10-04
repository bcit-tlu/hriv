import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import TransferCollectionDialog from '../../src/components/TransferCollectionDialog'
import type { User } from '../../src/types'
import { makeCollectionSummary } from '../helpers/fixtures'

const ADMIN: User = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  active: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
}
const INSTRUCTOR: User = {
  ...ADMIN,
  id: 2,
  name: 'Instructor',
  role: 'instructor',
  program_ids: [1, 3],
  program_names: ['Radiography', 'CT'],
}

const PROGRAMS = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Ultrasound', oidc_group: null, created_at: '', updated_at: '' },
  { id: 3, name: 'CT', oidc_group: null, created_at: '', updated_at: '' },
]

const PEOPLE: User[] = [
  { ...INSTRUCTOR, id: 7, name: 'Ada Lovelace', email: 'ada@example.com' },
  { ...INSTRUCTOR, id: 8, name: 'Inactive Iris', email: 'iris@example.com', active: false },
]

function makeAuth(user: User, users: User[] = []): AuthContextValue {
  return { currentUser: user, users, refreshUsers: vi.fn() } as unknown as AuthContextValue
}

function renderDialog(
  overrides: Partial<Parameters<typeof TransferCollectionDialog>[0]> = {},
  user: User = ADMIN,
  users: User[] = [],
) {
  const props = {
    open: true,
    onClose: vi.fn(),
    collection: makeCollectionSummary(),
    programs: PROGRAMS,
    onTransfer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(
    <AuthContext.Provider value={makeAuth(user, users)}>
      <TransferCollectionDialog {...props} />
    </AuthContext.Provider>,
  )
  return props
}

describe('TransferCollectionDialog', () => {
  it('lets an admin transfer to a program', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByLabelText('New owning program'))
    await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
    await user.click(screen.getByTestId('transfer-confirm'))
    await waitFor(() => expect(props.onTransfer).toHaveBeenCalledWith(1, { programId: 2 }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('lets an admin pick any active user as owner', async () => {
    const user = userEvent.setup()
    const props = renderDialog(
      {
        collection: makeCollectionSummary({
          owner: { kind: 'program', programId: 1, name: 'Radiography' },
        }),
      },
      ADMIN,
      PEOPLE,
    )
    await user.click(screen.getByLabelText('A user'))
    const input = screen.getByLabelText('New owner')
    await user.click(input)
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    // Inactive users are filtered out — the backend 422s them as targets.
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Ada Lovelace (ada@example.com)')
    await user.click(options[0])
    await user.click(screen.getByTestId('transfer-confirm'))
    await waitFor(() => expect(props.onTransfer).toHaveBeenCalledWith(1, { userId: 7 }))
  })

  it('narrows instructor program choices to their own programs', async () => {
    const user = userEvent.setup()
    renderDialog({}, INSTRUCTOR)
    expect(screen.queryByLabelText('A user')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('New owning program'))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('Radiography')).toBeInTheDocument()
    expect(within(listbox).getByText('CT')).toBeInTheDocument()
    expect(within(listbox).queryByText('Ultrasound')).not.toBeInTheDocument()
  })

  it('disables confirm while no target is chosen and when the target is unchanged', async () => {
    const user = userEvent.setup()
    renderDialog({
      collection: makeCollectionSummary({
        owner: { kind: 'program', programId: 1, name: 'Radiography' },
      }),
    })
    expect(screen.getByTestId('transfer-confirm')).toBeDisabled()
    await user.click(screen.getByLabelText('New owning program'))
    await user.click(within(await screen.findByRole('listbox')).getByText('Radiography'))
    // Already owned by Radiography — transferring to the same owner is a no-op.
    expect(screen.getByTestId('transfer-confirm')).toBeDisabled()
    await user.click(screen.getByLabelText('New owning program'))
    await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
    expect(screen.getByTestId('transfer-confirm')).toBeEnabled()
  })

  it('shows the orphaned hint when the collection has no owner', () => {
    renderDialog({ collection: makeCollectionSummary({ owner: null }) })
    expect(screen.getByText(/This collection is orphaned/)).toBeInTheDocument()
  })

  it('surfaces backend 403 and 409 messages in the dialog', async () => {
    const user = userEvent.setup()
    const onTransfer = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(403, 'Only admins can transfer to a user.'))
      // A stale-version 409 carries the fresh record as `data`, not a message.
      .mockRejectedValueOnce(new ApiError(409, ''))
    renderDialog({ onTransfer })
    await user.click(screen.getByLabelText('New owning program'))
    await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
    await user.click(screen.getByTestId('transfer-confirm'))
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent(
      'Only admins can transfer to a user.',
    )
    await user.click(screen.getByTestId('transfer-confirm'))
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent(
      'This item was modified by another user. Please refresh and try again.',
    )
  })

  it('keeps the dialog open on failure and closes on success', async () => {
    const user = userEvent.setup()
    const onTransfer = vi.fn().mockRejectedValueOnce(new ApiError(403, 'nope'))
    const props = renderDialog({ onTransfer })
    await user.click(screen.getByLabelText('New owning program'))
    await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
    await user.click(screen.getByTestId('transfer-confirm'))
    await screen.findByTestId('transfer-error')
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
