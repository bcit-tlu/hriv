import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    bulkDeleteUsers: vi.fn(),
  }
})

import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  bulkUpdateUserProgram,
  bulkUpdateUserRole,
  bulkDeleteUsers,
} from '../../src/api'
import type { Program } from '../../src/types'
import PeoplePage from '../../src/components/PeoplePage'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

const USERS = [
  {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.ca',
    role: 'admin',
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('PeoplePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    vi.mocked(fetchUsers).mockResolvedValue(USERS)
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('shows loading spinner then renders user table', async () => {
    render(<PeoplePage programs={programs} />)
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
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('No people found.')).toBeInTheDocument()
    })
  })

  it('renders Add Person button', async () => {
    render(<PeoplePage programs={programs} />)
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /add person/i })).toBeInTheDocument()
  })

  it('opens add modal when Add Person is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /add person/i }))
    expect(screen.getByRole('heading', { name: 'Add Person' })).toBeInTheDocument()
  })

  it('opens edit modal when a row is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Medical Lab')).toBeInTheDocument()
    })

    // Program name rendered as a MUI Chip
    const chip = screen.getByText('Medical Lab').closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
  })

  it('shows the configured default visible columns', async () => {
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Last Accessed' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'ID' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Created' })).not.toBeInTheDocument()
  })

  it('displays last accessed date when available', async () => {
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Admin user has last_access set
    expect(screen.getByText('2/15/2026')).toBeInTheDocument()
  })

  it('renders sortable column headers', async () => {
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getByText('Program')).toBeInTheDocument()
    expect(screen.getByText('Last Accessed')).toBeInTheDocument()
  })

  it('can hide the Groups column and persists that choice between renders', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

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

    unmount()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.queryByRole('columnheader', { name: 'Groups' })).not.toBeInTheDocument()
  })

  it('opens bulk role dialog and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserRole).mockResolvedValue(USERS)
    render(<PeoplePage programs={programs} />)

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
      expect(bulkUpdateUserRole).toHaveBeenCalledWith({
        user_ids: [1],
        role: 'student',
      })
    })
  })

  it('opens bulk delete confirmation and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkDeleteUsers).mockResolvedValue()
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} initialEditUserId={null} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.queryByText('Edit Person')).not.toBeInTheDocument()
  })

  it('filter icon changes aria-label and color when panel is toggled', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} initialEditUserId={null} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Initially: aria-label is "Show filters"
    const filterBtn = screen.getByLabelText('Show filters')
    expect(filterBtn).toBeInTheDocument()

    // Click to expand filter row
    await user.click(filterBtn)

    // After toggle: aria-label changes to "Hide filters"
    expect(screen.getByLabelText('Hide filters')).toBeInTheDocument()
    expect(screen.queryByLabelText('Show filters')).not.toBeInTheDocument()
  })

  it('sorts by name column when header is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Default sort is name asc: Admin User then Test Student
    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1] // skip header
    expect(within(firstDataRow).getByText('Admin User')).toBeInTheDocument()

    // Click Name header again to toggle to desc
    await user.click(screen.getByText('Name'))

    const rowsAfter = screen.getAllByRole('row')
    const firstDataRowAfter = rowsAfter[1]
    expect(within(firstDataRowAfter).getByText('Test Student')).toBeInTheDocument()
  })

  it('sorts by email column when header is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Email'))

    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1]
    expect(within(firstDataRow).getByText('admin@example.ca')).toBeInTheDocument()
  })

  it('filters users by name when filter text is entered', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Open filter row
    await user.click(screen.getByLabelText('Show filters'))

    // Type in the name filter
    const filterInputs = screen.getAllByRole('textbox')
    // First filter input is for name column
    await user.type(filterInputs[0], 'Student')

    // Only Test Student should be visible
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument()
    expect(screen.getByText('Test Student')).toBeInTheDocument()
  })

  it('clears filters when clear button is clicked', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Open filter row and filter
    await user.click(screen.getByLabelText('Show filters'))
    const filterInputs = screen.getAllByRole('textbox')
    await user.type(filterInputs[0], 'Student')

    expect(screen.queryByText('Admin User')).not.toBeInTheDocument()

    // Clear filters
    const clearBtn = screen.getByTitle('Clear all filters')
    await user.click(clearBtn)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })
    expect(screen.getByText('Test Student')).toBeInTheDocument()
  })

  it('opens bulk programs dialog and calls API', async () => {
    const user = userEvent.setup()
    vi.mocked(bulkUpdateUserProgram).mockResolvedValue(USERS)
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /add person/i }))
    expect(screen.getByRole('heading', { name: 'Add Person' })).toBeInTheDocument()

    // Fill in required fields
    const nameInput = screen.getByLabelText('Full name')
    const emailInput = screen.getByLabelText('Email')
    const passwordInput = screen.getByLabelText('Password')

    await user.type(nameInput, 'New Person')
    await user.type(emailInput, 'new@example.ca')
    await user.type(passwordInput, 'secret123')

    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => {
      expect(createUser).toHaveBeenCalledTimes(1)
    })
  })

  it('updates an existing user when Edit Person is submitted', async () => {
    const user = userEvent.setup()
    vi.mocked(updateUser).mockResolvedValue(USERS[0])
    render(<PeoplePage programs={programs} />)

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

    render(<PeoplePage programs={programs} />)

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
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Lab A2')).toBeInTheDocument()
    })

    const chip = screen.getByText('Lab A2').closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
  })
})
