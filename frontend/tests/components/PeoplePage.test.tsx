import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  deleteUser,
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
    program_names: [], group_ids: [], group_names: [],
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
    program_names: ['Medical Lab'], group_ids: [], group_names: [],
    last_access: null,
    metadata_extra: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('PeoplePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchUsers).mockResolvedValue(USERS)
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
    expect(screen.getByText('Created')).toBeInTheDocument()
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
    render(
      <PeoplePage programs={programs} initialEditUserId={null} />,
    )

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    expect(screen.queryByText('Edit Person')).not.toBeInTheDocument()
  })
})
