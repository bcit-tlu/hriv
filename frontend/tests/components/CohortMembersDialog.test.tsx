import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CohortMembersDialog from '../../src/components/CohortMembersDialog'
import type { Program } from '../../src/types'
import type { ApiUser } from '../../src/api'
import * as api from '../../src/api'

vi.mock('../../src/api', () => ({
  fetchUsers: vi.fn(),
  addCohortMember: vi.fn(),
  removeCohortMember: vi.fn(),
}))

const cohort: Program = {
  id: 3,
  name: 'Cohort A',
  oidc_group: null,
  parent_program_id: 1,
  is_cohort: true,
  created_at: '',
  updated_at: '',
}

function mkUser(over: Partial<ApiUser>): ApiUser {
  return {
    id: 0,
    name: '',
    email: '',
    role: 'student',
    program_ids: [],
    program_names: [],
    last_access: null,
    metadata_extra: null,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

const users: ApiUser[] = [
  mkUser({ id: 1, name: 'Alice', email: 'alice@bcit.ca', program_ids: [1] }),
  mkUser({ id: 2, name: 'Bob', email: 'bob@bcit.ca', program_ids: [1, 3] }),
  // Student not in the tenant → ineligible
  mkUser({ id: 3, name: 'Carol', email: 'carol@bcit.ca', program_ids: [2] }),
  // Instructor in the tenant → never eligible
  mkUser({ id: 4, name: 'Dave', email: 'dave@bcit.ca', role: 'instructor', program_ids: [1] }),
]

describe('CohortMembersDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchUsers).mockResolvedValue(users)
    vi.mocked(api.addCohortMember).mockResolvedValue(mkUser({ id: 1 }))
    vi.mocked(api.removeCohortMember).mockResolvedValue(mkUser({ id: 2 }))
  })

  it('lists only students that belong to the cohort tenant', async () => {
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // Carol (other tenant) and Dave (instructor) are excluded.
    expect(screen.queryByText('Carol')).not.toBeInTheDocument()
    expect(screen.queryByText('Dave')).not.toBeInTheDocument()
  })

  it('reflects current membership in the switches', async () => {
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)
    await screen.findByText('Alice')

    // Alice is not a member (no program 3); Bob is.
    expect(screen.getByLabelText('toggle Alice membership')).not.toBeChecked()
    expect(screen.getByLabelText('toggle Bob membership')).toBeChecked()
  })

  it('adds a student via the delta endpoint when toggled on', async () => {
    const user = userEvent.setup()
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)
    await screen.findByText('Alice')

    await user.click(screen.getByLabelText('toggle Alice membership'))

    expect(api.addCohortMember).toHaveBeenCalledWith(3, 1)
    await waitFor(() =>
      expect(screen.getByLabelText('toggle Alice membership')).toBeChecked(),
    )
  })

  it('removes a student via the delta endpoint when toggled off', async () => {
    const user = userEvent.setup()
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)
    await screen.findByText('Bob')

    await user.click(screen.getByLabelText('toggle Bob membership'))

    expect(api.removeCohortMember).toHaveBeenCalledWith(3, 2)
    await waitFor(() =>
      expect(screen.getByLabelText('toggle Bob membership')).not.toBeChecked(),
    )
  })

  it('surfaces an error when the membership write fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.addCohortMember).mockRejectedValueOnce(new Error('boom'))
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)
    await screen.findByText('Alice')

    await user.click(screen.getByLabelText('toggle Alice membership'))

    expect(await screen.findByText(/failed to add student/i)).toBeInTheDocument()
  })

  it('shows an empty message when no students are eligible', async () => {
    vi.mocked(api.fetchUsers).mockResolvedValue([])
    render(<CohortMembersDialog open onClose={vi.fn()} cohort={cohort} />)
    expect(
      await screen.findByText(/no eligible students/i),
    ).toBeInTheDocument()
  })
})
