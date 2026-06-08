import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchPrograms: vi.fn(),
    fetchUsersPaged: vi.fn(),
    addGroupMembersBulk: vi.fn(),
    addGroupInstructorsBulk: vi.fn(),
    removeGroupMember: vi.fn(),
    removeGroupInstructor: vi.fn(),
  }
})

import {
  fetchPrograms,
  fetchUsersPaged,
  addGroupMembersBulk,
  addGroupInstructorsBulk,
  removeGroupMember,
  removeGroupInstructor,
} from '../../src/api'
import type { ApiGroup, ApiProgram, ApiUser, UserListParams } from '../../src/api'
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
    group_ids: [],
    group_names: [],
    last_access: null,
    metadata_extra: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const PROGRAMS: ApiProgram[] = [
  { id: 1, name: 'Digital Design', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Architecture', oidc_group: null, created_at: '', updated_at: '' },
]

const STUDENTS: ApiUser[] = [
  makeApiUser({ id: 101, name: 'Alice Student', email: 'alice@bcit.ca', program_ids: [1], program_names: ['Digital Design'] }),
  makeApiUser({ id: 102, name: 'Bob Student', email: 'bob@bcit.ca', program_ids: [2], program_names: ['Architecture'] }),
]

const INSTRUCTORS: ApiUser[] = [
  makeApiUser({ id: 201, name: 'Carol Instructor', email: 'carol@bcit.ca', role: 'instructor' }),
  makeApiUser({ id: 202, name: 'Dave Instructor', email: 'dave@bcit.ca', role: 'instructor' }),
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchPrograms).mockResolvedValue(PROGRAMS)
  vi.mocked(fetchUsersPaged).mockImplementation((params: UserListParams) => {
    const all = params.role === 'instructor' ? INSTRUCTORS : STUDENTS
    const filtered =
      params.programIds && params.programIds.length > 0
        ? all.filter((u) => u.program_ids.some((p) => params.programIds!.includes(p)))
        : all
    const q = params.q?.toLowerCase()
    const matched = q
      ? filtered.filter(
          (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
        )
      : filtered
    return Promise.resolve({ items: matched, total: matched.length })
  })
})

describe('GroupMembersDialog', () => {
  it('lists students in a paginated table, flagging existing members', async () => {
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )

    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())
    expect(screen.getByText('Bob Student')).toBeInTheDocument()
    expect(fetchUsersPaged).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'student', page: 1, pageSize: 10 }),
    )

    // Alice (101) is already a member → "Member" chip + remove control,
    // Bob (102) is selectable for bulk add.
    expect(screen.getByText('Member')).toBeInTheDocument()
    expect(screen.getByLabelText('remove Alice Student')).toBeInTheDocument()
    expect(screen.getByLabelText('select Bob Student')).toBeInTheDocument()
    expect(screen.queryByLabelText('select Alice Student')).not.toBeInTheDocument()
  })

  it('bulk-adds the selected students and propagates the updated group', async () => {
    const user = userEvent.setup()
    const onGroupUpdated = vi.fn()
    vi.mocked(addGroupMembersBulk).mockResolvedValue(apiGroup({ member_ids: [101, 102] }))

    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={onGroupUpdated} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('select Bob Student'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add 1 to group/i }))

    await waitFor(() => expect(addGroupMembersBulk).toHaveBeenCalledWith(5, [102]))
    expect(onGroupUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, memberIds: [101, 102] }),
    )
  })

  it('selects every selectable row on the page via the header checkbox', async () => {
    const user = userEvent.setup()
    vi.mocked(addGroupMembersBulk).mockResolvedValue(apiGroup({ member_ids: [101, 102] }))
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('select all on page'))
    // Only Bob is selectable (Alice is already a member).
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('filters by program via the OR-semantics chips', async () => {
    const user = userEvent.setup()
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Architecture' }))

    await waitFor(() =>
      expect(fetchUsersPaged).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'student', programIds: [2] }),
      ),
    )
    await waitFor(() => expect(screen.queryByText('Alice Student')).not.toBeInTheDocument())
    expect(screen.getByText('Bob Student')).toBeInTheDocument()
  })

  it('searches by name/email (debounced)', async () => {
    const user = userEvent.setup()
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Search name or email'), 'bob')

    await waitFor(() =>
      expect(fetchUsersPaged).toHaveBeenCalledWith(expect.objectContaining({ q: 'bob' })),
    )
    await waitFor(() => expect(screen.queryByText('Alice Student')).not.toBeInTheDocument())
  })

  it('switches to the Instructors tab (no program filter) and bulk-adds a co-owner', async () => {
    const user = userEvent.setup()
    const onGroupUpdated = vi.fn()
    vi.mocked(addGroupInstructorsBulk).mockResolvedValue(
      apiGroup({ instructor_ids: [201, 202] }),
    )
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={onGroupUpdated} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'Instructors' }))

    await waitFor(() =>
      expect(fetchUsersPaged).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'instructor' }),
      ),
    )
    // No program filter chips on the instructors tab.
    expect(screen.queryByText('Filter by program')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Dave Instructor')).toBeInTheDocument())

    await user.click(screen.getByLabelText('select Dave Instructor'))
    await user.click(screen.getByRole('button', { name: /add 1 to group/i }))

    await waitFor(() => expect(addGroupInstructorsBulk).toHaveBeenCalledWith(5, [202]))
    expect(onGroupUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, instructorIds: [201, 202] }),
    )
  })

  it('removes an existing member', async () => {
    const user = userEvent.setup()
    const onGroupUpdated = vi.fn()
    vi.mocked(removeGroupMember).mockResolvedValue(apiGroup({ member_ids: [] }))
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={onGroupUpdated} />,
    )
    await waitFor(() => expect(screen.getByLabelText('remove Alice Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('remove Alice Student'))

    await waitFor(() => expect(removeGroupMember).toHaveBeenCalledWith(5, 101))
    expect(onGroupUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, memberIds: [] }),
    )
  })

  it('removes an existing co-owner from the Instructors tab', async () => {
    const user = userEvent.setup()
    const onGroupUpdated = vi.fn()
    vi.mocked(removeGroupInstructor).mockResolvedValue(apiGroup({ instructor_ids: [] }))
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={onGroupUpdated} />,
    )
    await waitFor(() => expect(screen.getByText('Alice Student')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'Instructors' }))
    await waitFor(() =>
      expect(screen.getByLabelText('remove Carol Instructor')).toBeInTheDocument(),
    )
    expect(screen.getByText('Co-owner')).toBeInTheDocument()

    await user.click(screen.getByLabelText('remove Carol Instructor'))

    await waitFor(() => expect(removeGroupInstructor).toHaveBeenCalledWith(5, 201))
    expect(onGroupUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, instructorIds: [] }),
    )
  })

  it('surfaces an error when bulk add fails', async () => {
    const user = userEvent.setup()
    vi.mocked(addGroupMembersBulk).mockRejectedValue(new Error('boom'))
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())

    await user.click(screen.getByLabelText('select Bob Student'))
    await user.click(screen.getByRole('button', { name: /add 1 to group/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Failed to add the selected students to the group.'),
      ).toBeInTheDocument(),
    )
  })

  it('renders the program a student belongs to as a chip', async () => {
    render(
      <GroupMembersDialog open group={group} onClose={vi.fn()} onGroupUpdated={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Bob Student')).toBeInTheDocument())
    const bobRow = screen.getByText('Bob Student').closest('tr') as HTMLElement
    expect(within(bobRow).getByText('Architecture')).toBeInTheDocument()
  })
})
