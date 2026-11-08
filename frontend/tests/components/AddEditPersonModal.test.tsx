import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddEditPersonModal from '../../src/components/AddEditPersonModal'
import type { Program } from '../../src/types'
import { ApiError } from '../../src/api'
import type { ApiUser } from '../../src/api'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

const existingUser: ApiUser = {
  id: 5,
  name: 'Test User',
  email: 'test@example.ca',
  role: 'student',
  active: true,
  program_ids: [1],
  program_names: ['Medical Lab'],
  group_ids: [],
  group_names: [],
  last_access: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('AddEditPersonModal', () => {
  it('hides admin credential controls and omits the forced-change flag in self-profile mode', async () => {
    const actor = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const clear = vi.fn()
    render(
      <AddEditPersonModal
        open
        selfProfile
        onClose={vi.fn()}
        onSave={onSave}
        onClearPassword={clear}
        programs={programs}
        user={{ ...existingUser, has_local_password: true, must_change_password: true }}
      />,
    )
    expect(
      screen.queryByRole('switch', { name: 'Force password change on next login' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear password' })).not.toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('must_change_password')
    expect(clear).not.toHaveBeenCalled()
  })
  it('creates in invite mode without a password field', async () => {
    const actor = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={onSave} programs={programs} />)
    await actor.click(screen.getByLabelText('Invite by link (user sets their own password)'))
    await actor.type(screen.getByLabelText('Full name'), 'Invited Guest')
    await actor.type(screen.getByLabelText('Email'), 'guest@example.invalid')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Add', exact: true }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('password')
  })

  it.each([
    [true, true, true, 'Managed by the identity provider'],
    [false, false, true, 'Set a local password before requiring a password change'],
    [false, true, false, ''],
  ] as const)(
    'controls forced change for oidc=%s password=%s',
    async (oidc, local, disabled, tooltip) => {
      const actor = userEvent.setup()
      const onSave = vi.fn()
      render(
        <AddEditPersonModal
          open
          onClose={vi.fn()}
          onSave={onSave}
          programs={programs}
          user={{ ...existingUser, oidc_linked: oidc, has_local_password: local }}
        />,
      )
      const toggle = screen.getByRole('switch', { name: 'Force password change on next login' })
      if (disabled) {
        expect(toggle).toBeDisabled()
        await actor.hover(screen.getByText('Force password change on next login'))
        expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip)
      } else {
        await actor.click(toggle)
        await actor.click(screen.getByRole('button', { name: 'Save', exact: true }))
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ must_change_password: true }))
      }
    },
  )

  it('confirms clearing a local password and leaves the confirm open on failure', async () => {
    const actor = userEvent.setup()
    const clear = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        onClearPassword={clear}
        programs={programs}
        user={{ ...existingUser, has_local_password: true }}
      />,
    )
    await actor.click(screen.getByRole('button', { name: 'Clear password' }))
    expect(clear).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Clear password?' })).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Clear password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not clear the password. Please retry.',
    )
    await actor.click(screen.getByRole('button', { name: 'Clear password' }))
    expect(clear).toHaveBeenCalledTimes(2)
  })

  beforeEach(() => vi.clearAllMocks())

  it('renders "Add Person" title when no user is provided', () => {
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)
    expect(screen.getByText('Add Person')).toBeInTheDocument()
  })

  it('renders "Edit Person" title when user is provided', () => {
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
        user={existingUser}
      />,
    )
    expect(screen.getByText('Edit Person')).toBeInTheDocument()
  })

  it('pre-fills fields when editing an existing user', () => {
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
        user={existingUser}
      />,
    )
    expect(screen.getByDisplayValue('Test User')).toBeInTheDocument()
    expect(screen.getByDisplayValue('test@example.ca')).toBeInTheDocument()
  })

  it('Add button is disabled when required fields are empty', () => {
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('calls onSave with form data when adding a new person', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={onSave} programs={programs} />)

    await user.type(screen.getByLabelText(/full name/i), 'New Person')
    await user.type(screen.getByLabelText(/email/i), 'new@example.ca')
    await user.type(screen.getByLabelText('Password'), 'secret123')

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Person',
        email: 'new@example.ca',
        password: 'secret123',
        role: 'student',
        active: true,
      }),
    )
  })

  it('calls onSave without password when editing (password left blank)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        user={existingUser}
      />,
    )

    // Just change the name
    const nameField = screen.getByDisplayValue('Test User')
    await user.clear(nameField)
    await user.type(nameField, 'Updated Name')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Updated Name',
        email: 'test@example.ca',
        active: true,
      }),
    )
    // Password should not be in the data when left blank
    expect(onSave.mock.calls[0][0].password).toBeUndefined()
  })

  it.each([false, true])(
    'requires eight characters for an entered password (edit=%s)',
    async (isEdit) => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <AddEditPersonModal
          open
          onClose={vi.fn()}
          onSave={onSave}
          programs={programs}
          user={isEdit ? existingUser : undefined}
        />,
      )
      if (!isEdit) {
        await user.type(screen.getByLabelText(/full name/i), 'New Person')
        await user.type(screen.getByLabelText(/email/i), 'new@example.ca')
      }
      const submit = screen.getByRole('button', { name: isEdit ? 'Save' : 'Add' })
      const password = screen.getByLabelText(isEdit ? 'Password (leave blank to keep)' : 'Password')
      if (isEdit) expect(submit).not.toBeDisabled()
      else expect(submit).toBeDisabled()
      await user.type(password, '1234567')
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
      expect(submit).toBeDisabled()
      expect(onSave).not.toHaveBeenCalled()
      await user.type(password, '8')
      expect(screen.queryByText('Password must be at least 8 characters')).not.toBeInTheDocument()
      expect(submit).not.toBeDisabled()
      await user.click(submit)
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ password: '12345678' }))
    },
  )

  it('shows student restriction helper text when role is student', () => {
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)
    expect(screen.getByText('Select one or more programs to restrict access')).toBeInTheDocument()
  })

  it('shows non-restrictive helper text when role is instructor', async () => {
    const user = userEvent.setup()
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)

    // Change role to instructor via MUI Select
    // The first combobox is the Role select, the second is Programs
    const selects = screen.getAllByRole('combobox')
    await user.click(selects[0])
    await user.click(screen.getByRole('option', { name: 'Instructor' }))

    expect(
      screen.getByText(
        /Instructors and admins can see all content regardless of program assignment/,
      ),
    ).toBeInTheDocument()
  })

  it('shows staff-specific helper text when role is staff', async () => {
    const user = userEvent.setup()
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)

    const selects = screen.getAllByRole('combobox')
    await user.click(selects[0])
    await user.click(screen.getByRole('option', { name: 'Staff' }))

    expect(
      screen.getByText(/Programs do not restrict staff — staff can view all content/),
    ).toBeInTheDocument()
  })

  it('shows non-restrictive helper text when role is admin', async () => {
    const user = userEvent.setup()
    render(<AddEditPersonModal open onClose={vi.fn()} onSave={vi.fn()} programs={programs} />)

    // Change role to admin via MUI Select
    const selects = screen.getAllByRole('combobox')
    await user.click(selects[0])
    await user.click(screen.getByRole('option', { name: 'Admin' }))

    expect(
      screen.getByText(
        /Instructors and admins can see all content regardless of program assignment/,
      ),
    ).toBeInTheDocument()
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddEditPersonModal open onClose={onClose} onSave={vi.fn()} programs={programs} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows inline error alert when onSave rejects', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new ApiError(422, 'Email already in use'))
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        user={existingUser}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already in use')
    // Save button should be re-enabled after error
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('Save button is disabled and Escape is blocked while saving', async () => {
    const user = userEvent.setup()
    let resolveSave!: () => void
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const onClose = vi.fn()
    render(
      <AddEditPersonModal
        open
        onClose={onClose}
        onSave={onSave}
        programs={programs}
        user={existingUser}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    // While in-flight: Save button disabled
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    // Escape should not call onClose while saving
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    // Resolve the save and confirm Save is re-enabled
    resolveSave()
    await screen.findByRole('button', { name: 'Save' })
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('can deactivate an account in edit mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        user={existingUser}
      />,
    )

    await user.click(screen.getByLabelText('Account active'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
      }),
    )
  })
})
