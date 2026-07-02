import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupManagementModal from '../../src/components/GroupManagementModal'
import { ApiError } from '../../src/api'
import type { ApiGroup, ApiProgram, ApiUser, UserListParams } from '../../src/api'
import type { Group } from '../../src/types'

const mockFetchPrograms = vi.fn<() => Promise<ApiProgram[]>>()
const mockFetchUsersPaged =
  vi.fn<(params: UserListParams) => Promise<{ items: ApiUser[]; total: number }>>()
const mockAddGroupMembersBulk = vi.fn()
const mockAddGroupInstructorsBulk = vi.fn()
const mockRemoveGroupMember = vi.fn()
const mockRemoveGroupInstructor = vi.fn()

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/api')>('../../src/api')
  return {
    ...actual,
    fetchPrograms: () => mockFetchPrograms(),
    fetchUsersPaged: (params: UserListParams) => mockFetchUsersPaged(params),
    addGroupMembersBulk: (...args: unknown[]) => mockAddGroupMembersBulk(...args),
    addGroupInstructorsBulk: (...args: unknown[]) => mockAddGroupInstructorsBulk(...args),
    removeGroupMember: (...args: unknown[]) => mockRemoveGroupMember(...args),
    removeGroupInstructor: (...args: unknown[]) => mockRemoveGroupInstructor(...args),
  }
})

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Cohort A',
    description: 'First cohort',
    createdByUserId: 201,
    memberIds: [],
    instructorIds: [201],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const groups: Group[] = [
  makeGroup({
    id: 1,
    name: 'Cohort A',
    description: 'First cohort',
    memberIds: [101],
    instructorIds: [201],
  }),
  makeGroup({ id: 2, name: 'Cohort B', description: null, memberIds: [] }),
]

function makeUser(overrides: Partial<ApiUser> = {}): ApiUser {
  return {
    id: 101,
    name: 'Student One',
    email: 'student1@example.test',
    role: 'student',
    program_ids: [1],
    program_names: ['Program A'],
    group_ids: [1],
    group_names: ['Cohort A'],
    last_access: null,
    metadata_extra: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const programs: ApiProgram[] = [
  { id: 1, name: 'Program A', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Program B', oidc_group: null, created_at: '', updated_at: '' },
]

const students = [
  makeUser(),
  makeUser({
    id: 102,
    name: 'Student Two',
    email: 'student2@example.test',
    program_ids: [2],
    program_names: ['Program B'],
    group_ids: [],
    group_names: [],
  }),
]

const instructors = [
  makeUser({
    id: 201,
    name: 'Instructor One',
    email: 'instructor1@example.test',
    role: 'instructor',
    program_ids: [],
    program_names: [],
    group_ids: [1],
    group_names: ['Cohort A'],
  }),
  makeUser({
    id: 202,
    name: 'Instructor Two',
    email: 'instructor2@example.test',
    role: 'instructor',
    program_ids: [],
    program_names: [],
    group_ids: [],
    group_names: [],
  }),
]

function apiGroup(overrides: Partial<ApiGroup> = {}): ApiGroup {
  return {
    id: 1,
    name: 'Cohort A',
    description: 'First cohort',
    created_by_user_id: 201,
    member_ids: [101],
    instructor_ids: [201],
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderModal(props: Partial<React.ComponentProps<typeof GroupManagementModal>> = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onAdd = props.onAdd ?? vi.fn()
  const onEdit = props.onEdit ?? vi.fn()
  const onDelete = props.onDelete ?? vi.fn()
  const onCategoryNavigate = props.onCategoryNavigate ?? vi.fn()
  const canManage = props.canManage ?? (() => true)
  const onGroupUpdated = props.onGroupUpdated ?? vi.fn()
  const result = render(
    <GroupManagementModal
      open
      onClose={onClose}
      groups={props.groups ?? groups}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      onCategoryNavigate={onCategoryNavigate}
      canManage={canManage}
      onGroupUpdated={onGroupUpdated}
    />,
  )
  return {
    ...result,
    onClose,
    onAdd,
    onEdit,
    onDelete,
    onCategoryNavigate,
    canManage,
    onGroupUpdated,
  }
}

describe('GroupManagementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchPrograms.mockResolvedValue(programs)
    mockFetchUsersPaged.mockImplementation((params) => {
      const source = params.role === 'instructor' ? instructors : students
      const filteredByProgram =
        params.programIds && params.programIds.length > 0
          ? source.filter((user) =>
              user.program_ids.some((programId) => params.programIds?.includes(programId)),
            )
          : source
      return Promise.resolve({
        items: filteredByProgram,
        total: filteredByProgram.length,
      })
    })
  })

  it('renders the redesigned master-detail group list', async () => {
    renderModal()
    expect(screen.getByText('Manage Groups')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create group/i })).toBeInTheDocument()
    expect(screen.getAllByText('Cohort A').length).toBeGreaterThan(0)
    expect(screen.getByText('Cohort B')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Filter by' })).toBeInTheDocument()
    expect(await screen.findByText('CURRENT MEMBERS')).toBeInTheDocument()
    expect(screen.getByText('AVAILABLE STUDENTS')).toBeInTheDocument()
    expect(mockFetchUsersPaged).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'student', page: 1, pageSize: 25 }),
    )
  })

  it('renders the selected group row with the subtle secondary group colour', async () => {
    renderModal()

    expect(await screen.findByText('CURRENT MEMBERS')).toBeInTheDocument()

    const selectedGroupRow = screen.getAllByText('Cohort A')[0].closest('.MuiListItemButton-root')
    expect(selectedGroupRow).not.toBeNull()
    expect(selectedGroupRow).toHaveStyle({
      backgroundColor: 'rgba(127, 102, 93, 0.16)',
      color: 'rgb(62, 60, 58)',
    })
  })

  it('renders the create and add actions with the strong secondary button colour', async () => {
    renderModal()

    expect(await screen.findByText('CURRENT MEMBERS')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /create group/i })).toHaveClass(
      'MuiButton-containedSecondary',
    )
    expect(screen.getByRole('button', { name: /add to group/i })).toHaveClass(
      'MuiButton-containedSecondary',
    )
  })

  it('renders table program chips with the standard primary filled styling', async () => {
    renderModal()

    const studentRow = (await screen.findByText('Student One')).closest('tr')
    expect(studentRow).not.toBeNull()

    const programChip = within(studentRow as HTMLElement).getByText('Program A')
    expect(programChip.closest('.MuiChip-root')).toHaveClass('MuiChip-filledPrimary')
  })

  it('shows an empty state when there are no groups', () => {
    renderModal({ groups: [] })
    expect(
      screen.getByText('No groups yet. Create a group to start adding students and instructors.'),
    ).toBeInTheDocument()
  })

  it('creates a group from the create group dialog', async () => {
    const { onAdd } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: '  New Group  ' } })
    fireEvent.change(screen.getByLabelText(/description \(optional\)/i), {
      target: { value: '  Created from modal  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onAdd).toHaveBeenCalledWith('New Group', 'Created from modal')
  })

  it('renames a group from the group actions menu', async () => {
    const { onEdit } = renderModal()

    fireEvent.click(screen.getByLabelText('group actions for Cohort A'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByLabelText(/group name/i)
    fireEvent.change(input, { target: { value: 'Cohort A2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith(1, 'Cohort A2', 'First cohort')
  })

  it('keeps failed group creation errors visible inside the create dialog', async () => {
    const onAdd = vi.fn().mockRejectedValue(new ApiError(409, 'Group name already exists'))
    renderModal({ onAdd })

    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: 'Existing Group' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Group name already exists')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create New Group' })).toBeInTheDocument()
  })

  it('surfaces backend detail when renaming a group fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new ApiError(409, 'Group name already exists'))
    renderModal({ onEdit })

    fireEvent.click(screen.getByLabelText('group actions for Cohort A'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByLabelText(/group name/i)
    fireEvent.change(input, { target: { value: 'Cohort A2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Group name already exists')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Rename Group' })).toBeInTheDocument()
  })

  it('confirms group deletion from the group actions menu', async () => {
    const { onDelete } = renderModal()

    fireEvent.click(screen.getByLabelText('group actions for Cohort A'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('surfaces backend detail when deleting a group fails', async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'Group is attached to one or more categories'))
    renderModal({ onDelete })

    fireEvent.click(screen.getByLabelText('group actions for Cohort A'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Group is attached to one or more categories'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete Group' })).toBeInTheDocument()
  })

  it('shows attached categories when delete is blocked by category restrictions', async () => {
    const user = userEvent.setup()
    const onCategoryNavigate = vi.fn()
    const onDelete = vi.fn().mockRejectedValue(
      new ApiError(409, 'Group is attached to one or more categories', {
        message: 'Group is attached to one or more categories',
        category_ids: [1, 2],
        categories: [
          { id: 1, label: 'Italian' },
          { id: 2, label: 'Gothic' },
        ],
      }),
    )
    renderModal({ onDelete, onCategoryNavigate })

    fireEvent.click(screen.getByLabelText('group actions for Cohort A'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Group is attached to one or more categories'),
    ).toBeInTheDocument()
    const toggle = screen.getByRole('button', {
      name: 'What categories?',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const italianLink = await screen.findByRole('button', { name: 'Italian' })
    const gothicLink = screen.getByRole('button', { name: 'Gothic' })
    expect(italianLink).toBeInTheDocument()
    expect(gothicLink).toBeInTheDocument()

    await user.click(italianLink)
    expect(onCategoryNavigate).toHaveBeenCalledWith(1)
  })

  it('adds selected available students and propagates the updated group', async () => {
    mockAddGroupMembersBulk.mockResolvedValue(apiGroup({ member_ids: [101, 102] }))
    const { onGroupUpdated } = renderModal()

    fireEvent.click(await screen.findByLabelText('select Student Two'))
    const fetchCallsBeforeAdd = mockFetchUsersPaged.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /add 1 to group/i }))

    expect(mockAddGroupMembersBulk).toHaveBeenCalledWith(1, [102])
    await waitFor(() =>
      expect(onGroupUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ memberIds: [101, 102] }),
      ),
    )
    expect(mockFetchUsersPaged).toHaveBeenCalledTimes(fetchCallsBeforeAdd)
  })

  it('filters available students by program dropdown in the redesigned detail panel', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('combobox', { name: 'Program' }))
    await user.click(await screen.findByRole('option', { name: 'Program B' }))

    await waitFor(() =>
      expect(mockFetchUsersPaged).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'student', programIds: [2] }),
      ),
    )
    expect(await screen.findByText('Student Two')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Student One')).not.toBeInTheDocument())
  })

  it('adds selected instructor co-owners from the instructors tab', async () => {
    const user = userEvent.setup()
    mockAddGroupInstructorsBulk.mockResolvedValue(apiGroup({ instructor_ids: [201, 202] }))
    const { onGroupUpdated } = renderModal()

    await user.click(screen.getByRole('tab', { name: /instructors/i }))
    await waitFor(() =>
      expect(mockFetchUsersPaged).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'instructor' }),
      ),
    )
    await user.click(await screen.findByLabelText('select Instructor Two'))
    await user.click(screen.getByRole('button', { name: /add 1 to group/i }))

    expect(mockAddGroupInstructorsBulk).toHaveBeenCalledWith(1, [202])
    await waitFor(() =>
      expect(onGroupUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ instructorIds: [201, 202] }),
      ),
    )
  })

  it('removes current students from the integrated membership table', async () => {
    const user = userEvent.setup()
    mockRemoveGroupMember.mockResolvedValue(apiGroup({ member_ids: [] }))
    const { onGroupUpdated } = renderModal()

    const studentRow = (await screen.findByText('Student One')).closest('tr')
    expect(studentRow).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(mockRemoveGroupMember).toHaveBeenCalledWith(1, 101)
    await waitFor(() =>
      expect(onGroupUpdated).toHaveBeenCalledWith(expect.objectContaining({ memberIds: [] })),
    )
  })

  it('disables group actions and membership changes when canManage returns false', async () => {
    renderModal({ canManage: () => false })
    expect(screen.getByLabelText('group actions for Cohort A')).toBeDisabled()
    expect(await screen.findByLabelText('select Student Two')).toBeDisabled()
    expect(screen.getByRole('button', { name: /add to group/i })).toBeDisabled()
  })

  it('close icon calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'close groups dialog' }))
    expect(onClose).toHaveBeenCalled()
  })
})
