import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupManagementModal from '../../src/components/GroupManagementModal'
import type { Group } from '../../src/types'

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Cohort A',
    description: 'First cohort',
    createdByUserId: 10,
    memberIds: [],
    instructorIds: [10],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const groups: Group[] = [
  makeGroup({ id: 1, name: 'Cohort A', description: 'First cohort' }),
  makeGroup({ id: 2, name: 'Cohort B', description: null }),
]

function renderModal(props: Partial<React.ComponentProps<typeof GroupManagementModal>> = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onAdd = props.onAdd ?? vi.fn()
  const onEdit = props.onEdit ?? vi.fn()
  const onDelete = props.onDelete ?? vi.fn()
  const onManageMembers = props.onManageMembers ?? vi.fn()
  const canManage = props.canManage ?? (() => true)
  const result = render(
    <GroupManagementModal
      open
      onClose={onClose}
      groups={props.groups ?? groups}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      onManageMembers={onManageMembers}
      canManage={canManage}
    />,
  )
  return { ...result, onClose, onAdd, onEdit, onDelete, onManageMembers, canManage }
}

describe('GroupManagementModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and group list', () => {
    renderModal()
    expect(screen.getByText('Manage Groups')).toBeInTheDocument()
    expect(screen.getByText('Cohort A')).toBeInTheDocument()
    expect(screen.getByText('Cohort B')).toBeInTheDocument()
    expect(screen.getByText('First cohort')).toBeInTheDocument()
  })

  it('shows "No groups yet" when list is empty', () => {
    renderModal({ groups: [] })
    expect(screen.getByText('No groups yet.')).toBeInTheDocument()
  })

  it('calls onAdd with trimmed name and description when Add is clicked', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderModal()

    await user.type(screen.getByLabelText(/new group name/i), '  New Group  ')
    await user.type(screen.getByLabelText(/description \(optional\)/i), '  desc  ')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith('New Group', 'desc')
  })

  it('passes null description when description left empty', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderModal()

    await user.type(screen.getByLabelText(/new group name/i), 'Group X{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Group X', null)
  })

  it('Add button is disabled when name is empty', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('calls onManageMembers when the members icon is clicked', async () => {
    const user = userEvent.setup()
    const { onManageMembers } = renderModal()

    await user.click(screen.getByLabelText('manage members of Cohort A'))
    expect(onManageMembers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Cohort A' }),
    )
  })

  it('calls onDelete when delete icon is clicked', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderModal()

    await user.click(screen.getAllByLabelText('delete group')[0])
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('enters edit mode and saves edited name and description', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderModal()

    await user.click(screen.getAllByLabelText('edit group')[0])
    const nameInput = screen.getByDisplayValue('Cohort A')
    await user.clear(nameInput)
    await user.type(nameInput, 'Cohort A2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith(1, 'Cohort A2', 'First cohort')
  })

  it('cancels edit mode without calling onEdit', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderModal()

    await user.click(screen.getAllByLabelText('edit group')[0])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('Cohort A')).toBeInTheDocument()
  })

  it('disables manage/edit/delete actions when canManage returns false', () => {
    renderModal({ canManage: () => false })
    expect(screen.getByLabelText('manage members of Cohort A')).toBeDisabled()
    expect(screen.getAllByLabelText('edit group')[0]).toBeDisabled()
    expect(screen.getAllByLabelText('delete group')[0]).toBeDisabled()
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
