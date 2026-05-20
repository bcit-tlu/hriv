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
  }
})

import {
  fetchUsers,
  deleteUser,
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
    last_access: null,
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
    // Should show spinner initially
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
    // Modal title is a heading
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

  it('calls deleteUser when Delete button is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteUser).mockResolvedValue()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i })
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(deleteUser).toHaveBeenCalledWith(1)
    })
  })

  it('shows Bulk Edit button when users are selected', async () => {
    const user = userEvent.setup()
    render(<PeoplePage programs={programs} />)

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument()
    })

    // Select the first checkbox (not the header "select all")
    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] is the "select all" header checkbox
    // checkboxes[1] is the first user row checkbox
    await user.click(checkboxes[1])

    expect(screen.getByText(/Bulk Edit.*1 selected/)).toBeInTheDocument()
  })
})
