import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddEditPersonModal from '../../src/components/AddEditPersonModal'
import type { Program } from '../../src/types'
import type { ApiUser } from '../../src/api'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', created_at: '', updated_at: '' },
]

const existingUser: ApiUser = {
  id: 5,
  name: 'Test User',
  email: 'test@example.ca',
  role: 'student',
  program_ids: [1],
  program_names: ['Medical Lab'],
  last_access: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('AddEditPersonModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders "Add Person" title when no user is provided', () => {
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
      />,
    )
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
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('calls onSave with form data when adding a new person', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <AddEditPersonModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
      />,
    )

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
      }),
    )
    // Password should not be in the data when left blank
    expect(onSave.mock.calls[0][0].password).toBeUndefined()
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <AddEditPersonModal
        open
        onClose={onClose}
        onSave={vi.fn()}
        programs={programs}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
