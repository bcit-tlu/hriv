import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import CollectionEditDialog from '../../src/components/CollectionEditDialog'
import type { CollectionEditDialogProps } from '../../src/components/CollectionEditDialog'
import { ApiError } from '../../src/api'
import type { Group, Program, Role } from '../../src/types'
import { makeApiCollection, makeCollection } from '../helpers/fixtures'

function makeAuth(role: Role, overrides: { id?: number; program_ids?: number[] } = {}) {
  return {
    currentUser: {
      id: overrides.id ?? 7,
      name: 'Test User',
      email: 'user@example.com',
      role,
      active: true,
      program_ids: overrides.program_ids ?? [],
      program_names: [],
      group_ids: [],
      group_names: [],
    },
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

const PROGRAMS: Program[] = [
  { id: 1, name: 'Program A', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Program B', oidc_group: null, created_at: '', updated_at: '' },
]

const GROUPS: Group[] = [
  {
    id: 10,
    name: 'Cohort 1',
    description: null,
    createdByUserId: 7,
    memberIds: [],
    instructorIds: [7],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 11,
    name: 'Cohort 2',
    description: null,
    createdByUserId: 8,
    memberIds: [],
    instructorIds: [8],
    createdAt: '',
    updatedAt: '',
  },
]

function renderDialog(
  props: Partial<CollectionEditDialogProps> = {},
  authValue: AuthContextValue = makeAuth('admin'),
) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined)
  const onClose = props.onClose ?? vi.fn()
  const utils = render(
    <AuthContext.Provider value={authValue}>
      <CollectionEditDialog
        open={props.open ?? true}
        onClose={onClose}
        onSave={onSave}
        collection={props.collection}
        defaultType={props.defaultType}
        programs={props.programs ?? PROGRAMS}
        groups={props.groups ?? GROUPS}
        onDelete={props.onDelete}
      />
    </AuthContext.Provider>,
  )
  return { ...utils, onSave, onClose }
}

describe('CollectionEditDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('create mode', () => {
    it('renders the New Collection title with type radios and defaults', () => {
      renderDialog()
      expect(screen.getByText('New Collection')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /Sequence/ })).toBeChecked()
      expect(screen.getByRole('radio', { name: /Synchronized/ })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: /^Private/ })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })

    it('seeds the type radio from defaultType (#1554 type pages)', () => {
      renderDialog({ defaultType: 'synchronized' })
      expect(screen.getByRole('radio', { name: /Synchronized/ })).toBeChecked()
      expect(screen.getByRole('radio', { name: /Sequence/ })).not.toBeChecked()
    })

    it('submits trimmed values with an empty scope when not restricted', async () => {
      const user = userEvent.setup()
      const { onSave, onClose } = renderDialog()
      await user.type(screen.getByLabelText('Collection name'), '  Skulls  ')
      await user.type(screen.getByLabelText('Description'), 'Frontal vs lateral')
      await user.click(screen.getByRole('radio', { name: /Synchronized/ }))
      await user.click(screen.getByRole('radio', { name: /^Public/ }))
      await user.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(onSave).toHaveBeenCalledWith(
        {
          name: 'Skulls',
          description: 'Frontal vs lateral',
          type: 'synchronized',
          visibility: 'public',
          programIds: [],
          groupIds: [],
        },
        null,
        null,
      )
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it('sends a null description when the field is blank', async () => {
      const user = userEvent.setup()
      const { onSave } = renderDialog()
      await user.type(screen.getByLabelText('Collection name'), 'Skulls')
      await user.keyboard('{Enter}')
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      expect(onSave.mock.calls[0][0].description).toBeNull()
    })
  })

  describe('edit mode', () => {
    it('pre-fills the form, locks the type, and passes the version on save', async () => {
      const user = userEvent.setup()
      const collection = makeCollection({
        name: 'Skull comparison',
        description: 'Frontal vs lateral',
        type: 'synchronized',
        visibility: 'public',
        version: 4,
      })
      const { onSave } = renderDialog({ collection })
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Skull comparison')).toBeInTheDocument()
      expect(screen.getByTestId('collection-type-chip')).toHaveTextContent('Synchronized')
      expect(screen.queryByRole('radio', { name: /Synchronized/ })).not.toBeInTheDocument()
      expect(screen.getByText('The type cannot be changed after creation.')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /^Public/ })).toBeChecked()

      await user.clear(screen.getByLabelText('Collection name'))
      await user.type(screen.getByLabelText('Collection name'), 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Renamed', type: 'synchronized' })
      expect(onSave.mock.calls[0][1]).toBe(4)
      expect(onSave.mock.calls[0][2]).toMatchObject({ id: collection.id, version: 4 })
    })

    it('seeds the restricted scope from the collection', () => {
      renderDialog({
        collection: makeCollection({ visibility: 'restricted', programIds: [2], groupIds: [11] }),
      })
      expect(screen.getByRole('radio', { name: /^Restricted/ })).toBeChecked()
      const chipB = screen.getByText('Program B').closest('[data-testid="program-chip"]')!
      const chipA = screen.getByText('Program A').closest('[data-testid="program-chip"]')!
      expect(chipB).toHaveClass('MuiChip-filled')
      expect(chipA).toHaveClass('MuiChip-outlined')
      const cohort2 = screen.getByText('Cohort 2').closest('[data-testid="group-chip"]')!
      expect(cohort2).toHaveClass('MuiChip-filled')
    })
  })

  describe('role gating', () => {
    it.each<Role>(['student', 'staff'])('hides the Restricted option for %s', (role) => {
      renderDialog({}, makeAuth(role))
      expect(screen.getByRole('radio', { name: /^Private/ })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /^Public/ })).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: /^Restricted/ })).not.toBeInTheDocument()
    })

    it.each<Role>(['admin', 'instructor'])('shows the Restricted option for %s', (role) => {
      renderDialog({}, makeAuth(role))
      expect(screen.getByRole('radio', { name: /^Restricted/ })).toBeInTheDocument()
    })

    it('shows program and group pickers only when Restricted is selected', async () => {
      const user = userEvent.setup()
      renderDialog()
      expect(screen.queryByTestId('program-chip')).not.toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: /^Restricted/ }))
      expect(screen.getAllByTestId('program-chip')).toHaveLength(2)
      expect(screen.getAllByTestId('group-chip')).toHaveLength(2)
    })

    it('requires at least one program or group when Restricted', async () => {
      const user = userEvent.setup()
      const { onSave } = renderDialog()
      await user.type(screen.getByLabelText('Collection name'), 'Scoped')
      await user.click(screen.getByRole('radio', { name: /^Restricted/ }))
      expect(
        screen.getByText('Select at least one program or group, or choose Public instead.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

      await user.click(screen.getByText('Program A'))
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
      await user.click(screen.getByText('Cohort 1'))
      expect(screen.getByText(/must be in a listed program/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      expect(onSave.mock.calls[0][0]).toMatchObject({
        visibility: 'restricted',
        programIds: [1],
        groupIds: [10],
      })
    })

    it('lets an admin attach any program or group', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.click(screen.getByRole('radio', { name: /^Restricted/ }))
      for (const label of ['Program A', 'Program B', 'Cohort 1', 'Cohort 2']) {
        expect(screen.getByText(label).closest('.MuiChip-root')).not.toHaveAttribute(
          'aria-disabled',
          'true',
        )
      }
      expect(screen.queryByText(/programs you belong to/)).not.toBeInTheDocument()
      expect(screen.queryByText(/groups you manage/)).not.toBeInTheDocument()
    })

    it('limits an instructor to programs they belong to and groups they manage', async () => {
      const user = userEvent.setup()
      const { onSave } = renderDialog({}, makeAuth('instructor', { id: 7, program_ids: [1] }))
      await user.type(screen.getByLabelText('Collection name'), 'Scoped')
      await user.click(screen.getByRole('radio', { name: /^Restricted/ }))

      const chipA = screen.getByText('Program A').closest('.MuiChip-root')!
      const chipB = screen.getByText('Program B').closest('.MuiChip-root')!
      const cohort1 = screen.getByText('Cohort 1').closest('.MuiChip-root')!
      const cohort2 = screen.getByText('Cohort 2').closest('.MuiChip-root')!
      expect(chipA).not.toHaveClass('Mui-disabled')
      expect(chipB).toHaveClass('Mui-disabled')
      expect(cohort1).not.toHaveClass('Mui-disabled')
      expect(cohort2).toHaveClass('Mui-disabled')
      expect(
        screen.getByText('You can only restrict to programs you belong to.'),
      ).toBeInTheDocument()
      expect(screen.getByText('You can only restrict to groups you manage.')).toBeInTheDocument()

      // Disabled chips have pointer-events: none; a synthetic click must be a no-op.
      fireEvent.click(chipB)
      fireEvent.click(cohort2)
      await user.click(chipA)
      await user.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      expect(onSave.mock.calls[0][0]).toMatchObject({ programIds: [1], groupIds: [] })
    })

    it('keeps an already-attached foreign program removable for an instructor', async () => {
      renderDialog(
        {
          collection: makeCollection({ visibility: 'restricted', programIds: [2], groupIds: [11] }),
        },
        makeAuth('instructor', { id: 7, program_ids: [1] }),
      )
      expect(screen.getByText('Program B').closest('.MuiChip-root')).not.toHaveClass('Mui-disabled')
      expect(screen.getByText('Cohort 2').closest('.MuiChip-root')).not.toHaveClass('Mui-disabled')
    })
  })

  describe('errors', () => {
    it('shows the API message when saving fails and keeps the dialog open', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new ApiError(403, 'Not allowed'))
      const { onClose } = renderDialog({ onSave })
      await user.type(screen.getByLabelText('Collection name'), 'Skulls')
      await user.click(screen.getByRole('button', { name: 'Create' }))
      expect(await screen.findByText('Not allowed')).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    })

    it('falls back to a generic message for unexpected errors', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('boom'))
      renderDialog({ onSave })
      await user.type(screen.getByLabelText('Collection name'), 'Skulls')
      await user.click(screen.getByRole('button', { name: 'Create' }))
      expect(await screen.findByText('Failed to create collection.')).toBeInTheDocument()
    })

    it('offers to reload the current values after a stale-version 409', async () => {
      const user = userEvent.setup()
      const current = makeApiCollection({
        name: 'Renamed elsewhere',
        description: 'Fresh description',
        visibility: 'public',
        version: 9,
      })
      const onSave = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, '', current))
        .mockResolvedValue(undefined)
      const { onClose } = renderDialog({
        onSave,
        collection: makeCollection({ name: 'Mine', visibility: 'private', version: 1 }),
      })
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(
        await screen.findByText(
          'This item was modified by another user. Please refresh and try again.',
        ),
      ).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Reload' }))
      expect(screen.getByDisplayValue('Renamed elsewhere')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Fresh description')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /^Public/ })).toBeChecked()
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
      expect(onSave.mock.calls[1][1]).toBe(9)
      expect(onSave.mock.calls[1][2]).toMatchObject({ name: 'Renamed elsewhere', version: 9 })
    })

    it('lets an instructor remove scope attached elsewhere after a 409 reload', async () => {
      const user = userEvent.setup()
      const current = makeApiCollection({
        visibility: 'restricted',
        program_ids: [1, 2],
        group_ids: [10, 11],
        version: 3,
      })
      const onSave = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, '', current))
        .mockResolvedValue(undefined)
      renderDialog(
        {
          onSave,
          collection: makeCollection({
            visibility: 'restricted',
            programIds: [1],
            groupIds: [10],
            version: 2,
          }),
        },
        makeAuth('instructor', { id: 7, program_ids: [1] }),
      )
      expect(screen.getByText('Program B').closest('.MuiChip-root')).toHaveClass('Mui-disabled')

      await user.click(screen.getByRole('button', { name: 'Save' }))
      await user.click(await screen.findByRole('button', { name: 'Reload' }))

      const programB = screen.getByText('Program B').closest('.MuiChip-root')
      const cohort2 = screen.getByText('Cohort 2').closest('.MuiChip-root')
      expect(programB).not.toHaveClass('Mui-disabled')
      expect(cohort2).not.toHaveClass('Mui-disabled')
      await user.click(programB!)
      await user.click(cohort2!)
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
      expect(onSave.mock.calls[1][0]).toMatchObject({ programIds: [1], groupIds: [10] })
      expect(onSave.mock.calls[1][1]).toBe(3)
    })

    it('does not offer Reload for a 409 whose detail is not a collection', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new ApiError(409, 'Conflict'))
      renderDialog({ onSave, collection: makeCollection() })
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByText('Conflict')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    })
  })

  // Delete lives inside the edit dialog only (#1554) — the same
  // click-to-confirm pattern as EditImageModal.
  describe('delete', () => {
    it('shows no delete button in create mode', () => {
      renderDialog({ collection: null, onDelete: vi.fn() })
      expect(screen.queryByRole('button', { name: 'Delete Collection' })).not.toBeInTheDocument()
    })

    it('shows no delete button in edit mode without the onDelete prop', () => {
      renderDialog({ collection: makeCollection({ name: 'Mine' }) })
      expect(screen.queryByRole('button', { name: 'Delete Collection' })).not.toBeInTheDocument()
    })

    it('arms on the first click and deletes on the confirm click', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      renderDialog({ collection: makeCollection({ name: 'Doomed' }), onDelete })
      await user.click(screen.getByRole('button', { name: 'Delete Collection' }))
      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Confirm Delete Collection' }))
      await waitFor(() => expect(onDelete).toHaveBeenCalled())
    })

    it('re-arms and shows the API message when deletion fails', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockRejectedValue(new ApiError(409, 'In use'))
      renderDialog({ collection: makeCollection({ name: 'Busy' }), onDelete })
      await user.click(screen.getByRole('button', { name: 'Delete Collection' }))
      await user.click(screen.getByRole('button', { name: 'Confirm Delete Collection' }))
      expect(await screen.findByText('In use')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete Collection' })).toBeInTheDocument()
    })
  })

  it('re-seeds from the collection each time it opens', () => {
    const first = makeCollection({ name: 'First' })
    const { rerender } = render(
      <AuthContext.Provider value={makeAuth('admin')}>
        <CollectionEditDialog open onClose={vi.fn()} onSave={vi.fn()} collection={first} />
      </AuthContext.Provider>,
    )
    expect(screen.getByDisplayValue('First')).toBeInTheDocument()
    rerender(
      <AuthContext.Provider value={makeAuth('admin')}>
        <CollectionEditDialog open={false} onClose={vi.fn()} onSave={vi.fn()} collection={first} />
      </AuthContext.Provider>,
    )
    rerender(
      <AuthContext.Provider value={makeAuth('admin')}>
        <CollectionEditDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          collection={makeCollection({ name: 'Second' })}
        />
      </AuthContext.Provider>,
    )
    expect(screen.getByDisplayValue('Second')).toBeInTheDocument()
  })
})
