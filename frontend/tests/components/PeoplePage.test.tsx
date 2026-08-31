import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    bulkUpdateUserProgram: vi.fn(),
    bulkUpdateUserRole: vi.fn(),
    bulkUpdateUserActive: vi.fn(),
    bulkDeleteUsers: vi.fn(),
    addGroupMembersBulk: vi.fn(),
  }
})

import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  bulkUpdateUserProgram,
  bulkUpdateUserRole,
  bulkUpdateUserActive,
  bulkDeleteUsers,
  addGroupMembersBulk,
  ApiError,
} from '../../src/api'
import type { ApiGroup, ApiUser } from '../../src/api'
import type { Program, Group } from '../../src/types'
import PeoplePage from '../../src/components/PeoplePage'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

const groups: Group[] = [
  {
    id: 7,
    name: 'Lab A2',
    description: null,
    createdByUserId: null,
    memberIds: [],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 8,
    name: 'Lab B1',
    description: null,
    createdByUserId: null,
    memberIds: [],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
]

const USERS = [
  {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.ca',
    role: 'admin',
    active: true,
    program_ids: [],
    program_names: [],
    group_ids: [],
    group_names: [],
    last_access: '2026-02-15T10:00:00Z',
    metadata_extra: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Test Student',
    email: 'student@example.ca',
    role: 'student',
    active: true,
    program_ids: [1],
    program_names: ['Medical Lab'],
    group_ids: [7],
    group_names: ['Lab A2'],
    last_access: null,
    metadata_extra: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const USERS_A: ApiUser[] = [
  {
    ...USERS[0],
    name: 'A User',
  },
  USERS[1],
]

const USERS_B: ApiUser[] = [
  {
    ...USERS[0],
    name: 'B User',
  },
  USERS[1],
]

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('PeoplePage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    vi.mocked(fetchUsers).mockResolvedValue(USERS)
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('shows loading spinner then renders user table', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.getByText('admin@example.ca')).toBeInTheDocument()
    expect(screen.getByText('Test Student')).toBeInTheDocument()
    expect(fetchUsers).toHaveBeenCalledOnce()
  })

  it('shows "No people found" when list is empty', async () => {
    vi.mocked(fetchUsers).mockResolvedValue([])
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('No people found.')).toBeInTheDocument()
    })
  })

  it('renders Add Person button', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /add person/i })).toBeInTheDocument()
  })

  it('opens add modal when Add Person is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /add person/i }))
    expect(screen.getByRole('heading', { name: 'Add Person' })).toBeInTheDocument()
  })

  it('opens edit modal when a row is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Admin User'))
    expect(screen.getByText('Edit Person')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Admin User')).toBeInTheDocument()
  })

  it('calls deleteUser after confirming in the confirmation dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteUser).mockResolvedValue()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Click table row Delete button — opens confirmation dialog
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i })
    await user.click(deleteButtons[0])

    // Confirmation dialog appears
    expect(screen.getByText('Delete Person')).toBeInTheDocument()
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()

    // Confirm deletion via dialog button
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(deleteUser).toHaveBeenCalledWith(1)
    })
  })

  it('shows bulk action buttons when users are selected', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    expect(screen.getByText('Bulk Programs (1)')).toBeInTheDocument()
    expect(screen.getByText('Bulk Role (1)')).toBeInTheDocument()
    expect(screen.getByText('Delete (1)')).toBeInTheDocument()
  })

  it('displays program names as chips', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getAllByText('Medical Lab').length).toBeGreaterThan(0)
    })

    // Program name rendered as a chip in the student's table row
    const studentRow = screen.getByText('Test Student').closest('tr')
    expect(studentRow).not.toBeNull()
    expect(
      within(studentRow as HTMLElement)
        .getByText('Medical Lab')
        .closest('[data-testid="program-chip"]'),
    ).toBeInTheDocument()
  })

  it('shows the configured default visible columns', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Last Accessed' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'ID' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Created' })).not.toBeInTheDocument()
  })

  it('displays last accessed date when available', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Admin user has last_access set
    expect(screen.getByText('2/15/2026')).toBeInTheDocument()
  })

  it('renders sortable column headers', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Last Accessed' })).toBeInTheDocument()
  })

  it('can hide the Groups column and persists that choice between renders', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    expect(within(filterBar).getByRole('button', { name: 'Group' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Groups' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose columns' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose people table columns' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Groups' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Choose people table columns' }),
      ).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('columnheader', { name: 'Groups' })).not.toBeInTheDocument()
    expect(within(filterBar).queryByRole('button', { name: 'Group' })).not.toBeInTheDocument()

    unmount()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.queryByRole('columnheader', { name: 'Groups' })).not.toBeInTheDocument()
  })

  it('opens bulk role dialog and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserRole).mockResolvedValue(USERS)
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Select first user
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    // Open bulk role dialog
    await user.click(screen.getByText('Bulk Role (1)'))
    expect(screen.getByText('Bulk Update Role')).toBeInTheDocument()

    // Submit with default role (student)
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(bulkUpdateUserRole).toHaveBeenCalledWith(
        {
          user_ids: [1],
          role: 'student',
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
  })

  it('opens bulk status dialog and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserActive).mockResolvedValue(USERS)
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Status (1)'))
    expect(screen.getByText('Bulk Update Status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(bulkUpdateUserActive).toHaveBeenCalledWith({
        user_ids: [1],
        active: true,
      })
    })
  })

  it('locks bulk status dialog while save is pending', async () => {
    const user = userEvent.setup()
    let resolveSave: ((value: typeof USERS) => void) | null = null
    vi.mocked(bulkUpdateUserActive).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(screen.getByText('Bulk Status (1)'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      resolveSave?.(USERS)
    })

    await waitFor(() => {
      expect(screen.queryByText('Bulk Update Status')).not.toBeInTheDocument()
    })
  })

  it('re-enables bulk status dialog controls when save fails', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserActive).mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(screen.getByText('Bulk Status (1)'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to update status. Please try again.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('opens bulk delete confirmation and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkDeleteUsers).mockResolvedValue()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Select first user
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    // Open bulk delete dialog
    await user.click(screen.getByText('Delete (1)'))
    expect(screen.getByText('Delete Users')).toBeInTheDocument()

    // Confirm delete
    await user.click(screen.getByRole('button', { name: /delete 1 user/i }))

    await waitFor(() => {
      expect(bulkDeleteUsers).toHaveBeenCalledWith({
        user_ids: [1],
      })
    })
  })

  it('renders pagination controls', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // MUI TablePagination renders rows per page text
    expect(screen.getByText('Rows per page:')).toBeInTheDocument()
  })

  it('opens edit modal automatically when initialEditUserId is provided', async () => {
    const handleEditHandled = vi.fn()
    render(
      <PeoplePage
        programs={programs}
        groups={groups}
        initialEditUserId={2}
        onEditUserHandled={handleEditHandled}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Edit Person')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Test Student')).toBeInTheDocument()
    expect(handleEditHandled).toHaveBeenCalled()
  })

  it('does not open edit modal when initialEditUserId is null', async () => {
    render(<PeoplePage programs={programs} groups={groups} initialEditUserId={null} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.queryByText('Edit Person')).not.toBeInTheDocument()
  })

  it('renders a persistent filter bar with the recommended heading', async () => {
    render(<PeoplePage programs={programs} groups={groups} initialEditUserId={null} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    expect(within(filterBar).getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: 'Email' })).toBeInTheDocument()
  })

  it('sorts by name column when header is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Default sort is name asc: Admin User then Test Student
    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1] // skip header
    expect(within(firstDataRow).getByText('Admin User')).toBeInTheDocument()

    // Click Name header again to toggle to desc
    await user.click(within(screen.getByRole('columnheader', { name: 'Name' })).getByRole('button'))

    const rowsAfter = screen.getAllByRole('row')
    const firstDataRowAfter = rowsAfter[1]
    expect(within(firstDataRowAfter).getByText('Test Student')).toBeInTheDocument()
  })

  it('sorts by email column when header is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(
      within(screen.getByRole('columnheader', { name: 'Email' })).getByRole('button'),
    )

    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1]
    expect(within(firstDataRow).getByText('admin@example.ca')).toBeInTheDocument()
  })

  it('filters users by name when filter text is entered', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Search name'), 'Student')
    await user.click(nameFilterButton)

    // Only Test Student should be visible
    expect(screen.queryByRole('cell', { name: 'Admin User' })).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Test Student' })).toBeInTheDocument()
  })

  it('matches comma-separated name filters with AND semantics', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Search name'), 'Admin, User')
    await user.click(nameFilterButton)

    expect(screen.getByRole('cell', { name: 'Admin User' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Test Student' })).not.toBeInTheDocument()
    expect(within(filterBar).getByText('Name: Admin')).toBeInTheDocument()
    expect(within(filterBar).getByText('Name: User')).toBeInTheDocument()
    expect(within(filterBar).queryByText('Name: Admin, User')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 people')).toBeInTheDocument()
  })

  it('uses additive checkbox role filters and shows the filtered result total', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(within(filterBar).getByRole('button', { name: 'Role' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'student' }))

    expect(screen.getByRole('cell', { name: 'Test Student' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Admin User' })).not.toBeInTheDocument()
    expect(screen.queryByText('0 of 2 people')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 people')).toBeInTheDocument()
  })

  it('resets to the first page when the role filter changes', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchUsers).mockResolvedValue([
      USERS[0],
      ...Array.from({ length: 5 }, (_, index) => ({
        id: index + 2,
        name: `Student ${index + 1}`,
        email: `student${index + 1}@example.ca`,
        role: 'student',
        program_ids: [1],
        program_names: ['Medical Lab'],
        group_ids: [7],
        group_names: ['Lab A2'],
        last_access: null,
        metadata_extra: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })),
    ])
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('Rows per page:'))
    await user.click(screen.getByRole('option', { name: '5' }))
    await user.click(screen.getByLabelText('Go to next page'))

    await waitFor(() => {
      expect(screen.getByText('6–6 of 6')).toBeInTheDocument()
      expect(screen.getByText('Student 5')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(within(filterBar).getByRole('button', { name: 'Role' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'admin' }))

    await waitFor(() => {
      expect(screen.getByText('1–1 of 1')).toBeInTheDocument()
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
  })

  it('shows an in-table no-match message when filters exclude all people', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Search name'), 'Nobody')

    expect(screen.getByText('No people match the selected filters.')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 people')).toBeInTheDocument()
  })

  it('clears filters when clear button is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Search name'), 'Student')
    await user.click(nameFilterButton)

    expect(screen.queryByText('Admin User')).not.toBeInTheDocument()

    await user.click(within(filterBar).getByRole('button', { name: 'Clear all' }))

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.getByText('Test Student')).toBeInTheDocument()
  })

  it('opens bulk programs dialog and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserProgram).mockResolvedValue(USERS)
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Select first user
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    // Open bulk programs dialog
    await user.click(screen.getByText('Bulk Programs (1)'))
    expect(screen.getByText('Bulk Edit Programs')).toBeInTheDocument()
  })

  it('select-all checkbox selects all page users', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Click select-all (first checkbox)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    // Bulk action buttons should show count for all users
    expect(screen.getByText('Delete (2)')).toBeInTheDocument()
  })

  it('creates a new user when Add Person is submitted', async () => {
    const user = userEvent.setup()
    vi.mocked(createUser).mockResolvedValue({
      ...USERS[0],
      id: 99,
      name: 'New Person',
      email: 'new@example.ca',
      role: 'student',
    })
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /add person/i }))
    const dialog = screen.getByRole('dialog', { name: 'Add Person' })
    expect(dialog).toBeInTheDocument()

    // Fill in required fields
    const nameInput = within(dialog).getByLabelText('Full name')
    const emailInput = within(dialog).getByLabelText('Email')
    const passwordInput = within(dialog).getByLabelText('Password')

    await user.type(nameInput, 'New Person')
    await user.type(emailInput, 'new@example.ca')
    await user.type(passwordInput, 'secret123')

    await user.click(within(dialog).getByRole('button', { name: /^add$/i }))

    await waitFor(() => {
      expect(createUser).toHaveBeenCalledTimes(1)
    })
  })

  it('updates an existing user when Edit Person is submitted', async () => {
    const user = userEvent.setup()
    vi.mocked(updateUser).mockResolvedValue(USERS[0])
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Click row to open edit
    await user.click(screen.getByText('Admin User'))
    expect(screen.getByText('Edit Person')).toBeInTheDocument()

    // Modify name
    const nameInput = screen.getByDisplayValue('Admin User')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Admin')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the people table visible while refetching after an edit save', async () => {
    const user = userEvent.setup()
    const refreshedUsers = [
      {
        ...USERS[0],
        name: 'Updated Admin',
      },
      USERS[1],
    ]
    const refreshRequest = createDeferred<typeof refreshedUsers>()

    vi.mocked(fetchUsers)
      .mockResolvedValueOnce(USERS)
      .mockImplementationOnce(() => refreshRequest.promise)
    vi.mocked(updateUser).mockResolvedValue(refreshedUsers[0])

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Admin User'))
    const nameInput = screen.getByDisplayValue('Admin User')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Admin')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Edit Person' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    refreshRequest.resolve(refreshedUsers)

    await waitFor(() => {
      expect(screen.getByText('Updated Admin')).toBeInTheDocument()
    })
  })

  it('displays group names as chips', async () => {
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Test Student')).toBeInTheDocument()
    })

    const studentRow = screen.getByText('Test Student').closest('tr')
    expect(studentRow).not.toBeNull()
    expect(within(studentRow as HTMLElement).getByText('Lab A2')).toBeInTheDocument()
    expect(
      within(studentRow as HTMLElement)
        .getByText('Lab A2')
        .closest('[data-testid="group-chip"]'),
    ).toBeInTheDocument()
  })

  it('renders inactive status chips', async () => {
    vi.mocked(fetchUsers).mockResolvedValueOnce([
      USERS[0],
      {
        ...USERS[1],
        active: false,
      },
    ])
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Test Student')).toBeInTheDocument()
    })

    const studentRow = screen.getByText('Test Student').closest('tr')
    expect(studentRow).not.toBeNull()
    expect(within(studentRow as HTMLElement).getByText('Inactive')).toBeInTheDocument()
  })

  it('opens bulk groups dialog and calls addGroupMembersBulk', async () => {
    const user = userEvent.setup()
    const apiGroup: ApiGroup = {
      id: 7,
      name: 'Lab A2',
      description: null,
      created_by_user_id: null,
      member_ids: [1, 2],
      instructor_ids: [],
      created_at: '',
      updated_at: '',
    }
    vi.mocked(addGroupMembersBulk).mockResolvedValue(apiGroup)
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Select first user
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    // Open bulk groups dialog
    await user.click(screen.getByText('Bulk Groups (1)'))
    expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()

    // Select group and save
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    // Close the dropdown
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    expect(addGroupMembersBulk).toHaveBeenCalledWith(7, [1])
  })

  it('keeps bulk groups dialog open and shows an error when the save fails', async () => {
    const user = userEvent.setup()
    vi.mocked(addGroupMembersBulk).mockRejectedValue(new ApiError(422, 'Group add failed'))
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Groups (1)'))
    expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    await waitFor(() => {
      expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()
      expect(screen.getByText(/Failed to add 1 person to 1 of 1 group/i)).toBeInTheDocument()
      expect(screen.getByText(/Group add failed/i)).toBeInTheDocument()
    })
  })

  it('prunes succeeded groups and aggregates distinct failure reasons on partial failure', async () => {
    const user = userEvent.setup()
    const apiGroup: ApiGroup = {
      id: 7,
      name: 'Lab A2',
      description: null,
      created_by_user_id: null,
      member_ids: [1],
      instructor_ids: [],
      created_at: '',
      updated_at: '',
    }
    vi.mocked(addGroupMembersBulk).mockImplementation((groupId: number) =>
      groupId === 7
        ? Promise.resolve(apiGroup)
        : Promise.reject(new ApiError(422, 'Lab B1 add failed')),
    )
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Groups (1)'))
    expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.click(screen.getByRole('option', { name: 'Lab B1' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    await waitFor(() => {
      expect(
        screen.getByText(/Added to 1 group, but failed to add 1 person to 1 of 2 groups/i),
      ).toBeInTheDocument()
      expect(screen.getByText(/Lab B1 add failed/i)).toBeInTheDocument()
    })

    // Succeeded group is pruned from the selection; only the failed one remains
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Lab B1')).toBeInTheDocument()
    expect(within(dialog).queryByText('Lab A2')).not.toBeInTheDocument()
  })

  it('does not clobber page state from a stale bulk group save after the dialog is closed', async () => {
    const user = userEvent.setup()
    const { promise, resolve } = createDeferred<ApiGroup>()
    vi.mocked(addGroupMembersBulk).mockReturnValue(promise)
    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Groups (1)'))
    expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    // Close the dialog while the request is still in flight.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByText('Bulk Add to Groups')).not.toBeInTheDocument()
    })

    // Resolve the abandoned request.
    const apiGroup: ApiGroup = {
      id: 7,
      name: 'Lab A2',
      description: null,
      created_by_user_id: null,
      member_ids: [1, 2],
      instructor_ids: [],
      created_at: '',
      updated_at: '',
    }
    await act(async () => {
      resolve(apiGroup)
    })

    // The stale success must not surface a snackbar or reopen the dialog.
    expect(screen.queryByText('Bulk Add to Groups')).not.toBeInTheDocument()
    expect(screen.queryByText('Added to group(s).')).not.toBeInTheDocument()
  })

  it('does not overwrite newer user data when overlapping loadData fetches resolve in reverse order', async () => {
    const user = userEvent.setup()
    const { promise: p1, resolve: resolveP1 } = createDeferred<ApiUser[]>()
    const { promise: p2, resolve: resolveP2 } = createDeferred<ApiUser[]>()

    vi.mocked(fetchUsers)
      .mockResolvedValueOnce(USERS)
      .mockImplementationOnce(() => p1)
      .mockImplementationOnce(() => p2)
    vi.mocked(bulkDeleteUsers).mockResolvedValue(undefined)
    vi.mocked(bulkUpdateUserProgram).mockResolvedValue(USERS)

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')

    // First action starts a loadData fetch that will resolve later.
    await user.click(checkboxes[1])
    await user.click(screen.getByText('Delete (1)'))
    await user.click(screen.getByRole('button', { name: /delete 1 user/i }))

    // While that fetch is in flight, select the user and trigger a second loadData.
    await user.click(checkboxes[1])
    await user.click(screen.getByText('Bulk Programs (1)'))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Medical Lab' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Resolve the newer fetch first, then the older one.
    await act(async () => {
      resolveP2(USERS_B)
    })
    await waitFor(() => {
      expect(screen.getByText('B User')).toBeInTheDocument()
    })
    expect(screen.queryByText('A User')).not.toBeInTheDocument()

    await act(async () => {
      resolveP1(USERS_A)
    })
    await act(async () => {})
    expect(screen.getByText('B User')).toBeInTheDocument()
    expect(screen.queryByText('A User')).not.toBeInTheDocument()
  })

  it('does not clobber state when the bulk program dialog is closed while saving', async () => {
    const user = userEvent.setup()
    const { promise, resolve } = createDeferred<ApiUser[]>()
    vi.mocked(bulkUpdateUserProgram).mockReturnValue(promise)

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Programs (1)'))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Medical Lab' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Close the dialog while the request is still in flight.
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => {
      expect(screen.queryByText('Bulk Edit Programs')).not.toBeInTheDocument()
    })

    await act(async () => {
      resolve(USERS_A)
    })
    await act(async () => {})

    expect(screen.queryByText('Bulk Edit Programs')).not.toBeInTheDocument()
    expect(screen.queryByText('Programs updated.')).not.toBeInTheDocument()
    expect(screen.getByText('Bulk Programs (1)')).toBeInTheDocument()
    expect(fetchUsers).toHaveBeenCalledOnce()
  })

  it('does not clobber state when the bulk role dialog is closed while saving', async () => {
    const user = userEvent.setup()
    const { promise, resolve } = createDeferred<typeof USERS>()
    vi.mocked(bulkUpdateUserRole).mockReturnValue(promise)

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Role (1)'))
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Close the dialog while the request is still in flight.
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => {
      expect(screen.queryByText('Bulk Update Role')).not.toBeInTheDocument()
    })

    await act(async () => {
      resolve(USERS_A as typeof USERS)
    })
    await act(async () => {})

    expect(screen.queryByText('Bulk Update Role')).not.toBeInTheDocument()
    expect(screen.queryByText('Roles updated.')).not.toBeInTheDocument()
    expect(screen.getByText('Bulk Role (1)')).toBeInTheDocument()
    expect(fetchUsers).toHaveBeenCalledOnce()
  })

  it('ignores a stale bulk role request superseded by a newer save', async () => {
    const user = userEvent.setup()
    const { promise: p1, resolve: resolveP1 } = createDeferred<typeof USERS>()
    const { promise: p2, resolve: resolveP2 } = createDeferred<typeof USERS>()

    vi.mocked(bulkUpdateUserRole).mockReturnValueOnce(p1).mockReturnValueOnce(p2)
    vi.mocked(fetchUsers)
      .mockResolvedValueOnce(USERS)
      .mockResolvedValueOnce(USERS_B as typeof USERS)

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Role (1)'))

    // Trigger two saves without waiting for the first to finish.
    await user.click(screen.getByRole('button', { name: /save/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Resolve the newer request first.
    await act(async () => {
      resolveP2(USERS_B as typeof USERS)
    })
    await waitFor(() => {
      expect(screen.getByText('B User')).toBeInTheDocument()
    })
    expect(screen.queryByText('A User')).not.toBeInTheDocument()

    // Resolve the stale older request; it must not overwrite the newer result.
    await act(async () => {
      resolveP1(USERS_A as typeof USERS)
    })
    await act(async () => {})
    expect(screen.getByText('B User')).toBeInTheDocument()
    expect(screen.queryByText('A User')).not.toBeInTheDocument()
  })

  it('keeps the bulk program dialog open and shows an error when the refresh fails', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserProgram).mockResolvedValue(USERS)
    vi.mocked(fetchUsers)
      .mockResolvedValueOnce(USERS)
      .mockRejectedValueOnce(new ApiError(500, 'Refresh failed'))

    render(<PeoplePage programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await user.click(screen.getByText('Bulk Programs (1)'))
    expect(screen.getByText('Bulk Edit Programs')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Medical Lab' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText('Bulk Edit Programs')).toBeInTheDocument()
      expect(screen.getByText('Failed to update programs. Please try again.')).toBeInTheDocument()
    })
  })
})
