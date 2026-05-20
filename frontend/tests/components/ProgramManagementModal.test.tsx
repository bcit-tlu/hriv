import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgramManagementModal from '../../src/components/ProgramManagementModal'
import type { Program } from '../../src/types'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Dental Hygiene', oidc_group: null, created_at: '', updated_at: '' },
]

describe('ProgramManagementModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and program list', () => {
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Manage Programs')).toBeInTheDocument()
    expect(screen.getByText('Medical Lab')).toBeInTheDocument()
    expect(screen.getByText('Dental Hygiene')).toBeInTheDocument()
  })

  it('shows "No programs yet" when list is empty', () => {
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={[]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('No programs yet.')).toBeInTheDocument()
  })

  it('calls onAdd when typing a name and clicking Add', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={onAdd}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText(/new program name/i)
    await user.type(input, 'New Program')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith('New Program', null)
  })

  it('calls onAdd when pressing Enter in the text field', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={onAdd}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText(/new program name/i)
    await user.type(input, 'Enter Program{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Enter Program', null)
  })

  it('Add button is disabled when input is empty', () => {
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('calls onDelete when clicking delete icon', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const deleteButtons = screen.getAllByLabelText('delete program')
    await user.click(deleteButtons[0])
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('enters edit mode and saves edited program name', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    )

    const editButtons = screen.getAllByLabelText('edit program')
    await user.click(editButtons[0])

    // Should show a text field with the current name
    const editInput = screen.getByDisplayValue('Medical Lab')
    await user.clear(editInput)
    await user.type(editInput, 'Updated Lab')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith(1, 'Updated Lab', null)
  })

  it('cancels edit mode', async () => {
    const user = userEvent.setup()
    render(
      <ProgramManagementModal
        open
        onClose={vi.fn()}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const editButtons = screen.getAllByLabelText('edit program')
    await user.click(editButtons[0])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Should be back to non-edit mode
    expect(screen.getByText('Medical Lab')).toBeInTheDocument()
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ProgramManagementModal
        open
        onClose={onClose}
        programs={programs}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
