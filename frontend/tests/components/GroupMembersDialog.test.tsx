import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchUsers: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    addGroupInstructor: vi.fn(),
    removeGroupInstructor: vi.fn(),
  }
})

import {
  fetchUsers,
  addGroupMember,
  removeGroupMember,
  addGroupInstructor,
  removeGroupInstructor,
} from '../../src/api'
import type { ApiGroup, ApiUser } from '../../src/api'
import type { Group } from '../../src/types'
import GroupMembersDialog from '../../src/components/GroupMembersDialog'

function makeApiUser(overrides: Partial<ApiUser> = {}): ApiUser {
  return {
    id: 1,
    name: 'User',
    email: 'user@bcit.ca',
    role: 'student',
    program_ids: [],
    program_names: [],
    last_access: null,
    metadata_extra: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const STUDENTS: ApiUser[] = [
  makeApiUser({ id: 101, name: 'Alice Student', email: 'alice@bcit.ca', role: 'student' }),
  makeApiUser({ id: 102, name: 'Bob Student', email: 'bob@bcit.ca', role: 'student' }),
]

const INSTRUCTORS: ApiUser[] = [
  makeApiUser({ id: 201, name: 'Carol Instructor', email: 'carol@bcit.ca', role: 'instructor' }),
]

const group: Group = {
  id: 5,
  name: 'Cohort A',
  description: null,
  createdByUserId: 201,
  memberIds: [101],
  instructorIds: [201],
  createdAt: '',
  updatedAt: '',
}

function apiGroup(overrides: Partial<ApiGroup> = {}): ApiGroup {
  return {
    id: 5,
    name: 'Cohort A',
    description: null,
    created_by_user_id: 201,
    member_ids: [101],
    instructor_ids: [201],
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('GroupMembersDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchUsers).mockImplementation((role?: string) =>
      Promise.resolve(role === 'instructor' ? INSTRUCTORS : STUDENTS),
    )
  })

  it('loads and lists students and instructors, reflecting current membership', async () => {
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )

    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())
    expect(screen.getByText('Bob Student')).toBeInTheDocument()
    expect(screen.getByText('Carol Instructor')).toBeInTheDocument()
    expect(fetchUsers).toHaveBeenCalledWith('student')
    expect(fetchUsers).toHaveBeenCalledWith('instructor')

    // Alice is already a member, Bob is not
    expect(screen.getByLabelText('toggle Alice Student membership')).toBeChecked()
    expect(screen.getByLabelText('toggle Bob Student membership')).not.toBeChecked()
    expect(screen.getByLabelText('toggle Carol Instructor co-ownership')).toBeChecked()
  })

  it('does not re-fetch users when the group prop updates with the same id', async () => {
    const { rerender } = render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())
    const callsAfterLoad = vi.mocked(fetchUsers).mock.calls.length

    // The parent flows an updated group (same id) back in after a membership
    // mutation — selection must update without another user fetch.
    rerender(
      <GroupMembersDialog
        open
        group={{ ...group, memberIds: [101, 102] }}
        onClose={vi.fn()}
        onGroupUpdated={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByLabelText('toggle Bob Student membership')).toBeChecked(),
    )
    expect(vi.mocked(fetchUsers).mock.calls.length).toBe(callsAfterLoad)
  })

  it('adds a student member and propagates the updated group', async () => {
    const user = userEvent.setup()
    const onGroupUpdated = vi.fn()
    vi.mocked(addGroupMember).mockResolvedValue(apiGroup({ member_ids: [101, 102] }))

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={onGroupUpdated} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('toggle Bob Student membership'))

    await waitFor(() => expect(addGroupMember).toHaveBeenCalledWith(5, 102))
    await waitFor(() =>
      expect(screen.getByLabelText('toggle Bob Student membership')).toBeChecked(),
    )
    expect(onGroupUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, memberIds: [101, 102] }),
    )
  })

  it('removes a student member when toggled off', async () => {
    const user = userEvent.setup()
    vi.mocked(removeGroupMember).mockResolvedValue(apiGroup({ member_ids: [] }))

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('toggle Alice Student membership'))

    await waitFor(() => expect(removeGroupMember).toHaveBeenCalledWith(5, 101))
    await waitFor(() =>
      expect(screen.getByLabelText('toggle Alice Student membership')).not.toBeChecked(),
    )
  })

  it('adds an instructor co-owner', async () => {
    const user = userEvent.setup()
    vi.mocked(addGroupInstructor).mockResolvedValue(apiGroup({ instructor_ids: [201, 202] }))
    vi.mocked(fetchUsers).mockImplementation((role?: string) =>
      Promise.resolve(
        role === 'instructor'
          ? [
              ...INSTRUCTORS,
              makeApiUser({ id: 202, name: 'Dan Instructor', role: 'instructor' }),
            ]
          : STUDENTS,
      ),
    )

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Dan Instructor')).toBeInTheDocument())

    await user.click(screen.getByLabelText('toggle Dan Instructor co-ownership'))
    await waitFor(() => expect(addGroupInstructor).toHaveBeenCalledWith(5, 202))
  })

  it('shows error when membership toggle fails', async () => {
    const user = userEvent.setup()
    vi.mocked(addGroupMember).mockRejectedValue(new Error('boom'))

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('toggle Bob Student membership'))
    await waitFor(() =>
      expect(screen.getByText('Failed to add student to group.')).toBeInTheDocument(),
    )
  })

  it('surfaces the last-instructor guard error on removal failure', async () => {
    const user = userEvent.setup()
    vi.mocked(removeGroupInstructor).mockRejectedValue(new Error('409'))

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Carol Instructor')).toBeInTheDocument())

    await user.click(screen.getByLabelText('toggle Carol Instructor co-ownership'))
    await waitFor(() =>
      expect(
        screen.getByText('Failed to remove instructor (a group must keep at least one).'),
      ).toBeInTheDocument(),
    )
  })

  it('shows error when user loading fails', async () => {
    vi.mocked(fetchUsers).mockRejectedValue(new Error('network'))
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() =>
      expect(screen.getByText('Failed to load users.')).toBeInTheDocument(),
    )
  })

  it('does not fetch when closed', () => {
    render(
      <GroupMembersDialog open={false} group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    expect(fetchUsers).not.toHaveBeenCalled()
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <GroupMembersDialog open group={group} onClose={onClose} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
