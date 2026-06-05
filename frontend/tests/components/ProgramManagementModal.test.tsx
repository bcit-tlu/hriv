import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgramManagementModal from '../../src/components/ProgramManagementModal'
import type { Program } from '../../src/types'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: 'mlab-group', parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
  { id: 2, name: 'Dental Hygiene', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
  { id: 3, name: 'Cohort A', oidc_group: null, parent_program_id: 1, is_cohort: true, created_at: '', updated_at: '' },
]

function renderModal(props: Partial<React.ComponentProps<typeof ProgramManagementModal>> = {}) {
  return render(
    <ProgramManagementModal
      open
      onClose={vi.fn()}
      programs={programs}
      isAdmin
      myProgramIds={[]}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onManageMembers={vi.fn()}
      {...props}
    />,
  )
}

describe('ProgramManagementModal — admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the admin title and full program list', () => {
    renderModal()
    expect(screen.getByText('Manage Programs')).toBeInTheDocument()
    expect(screen.getByText('Medical Lab')).toBeInTheDocument()
    expect(screen.getByText('Dental Hygiene')).toBeInTheDocument()
    expect(screen.getByText('Cohort A')).toBeInTheDocument()
  })

  it('shows "No programs yet" when list is empty', () => {
    renderModal({ programs: [] })
    expect(screen.getByText('No programs yet.')).toBeInTheDocument()
  })

  it('calls onAdd with a null parent for a top-level program', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderModal({ onAdd })

    await user.type(screen.getByLabelText(/new program name/i), 'New Program')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith('New Program', null, null)
  })

  it('Add button is disabled when input is empty', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('hides the OIDC field behind an Advanced disclosure (issue #559)', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderModal({ onAdd })

    // Not visible until Advanced is expanded.
    expect(screen.queryByLabelText(/oidc group \(optional\)/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/new program name/i), 'Radiology')
    await user.click(screen.getByRole('button', { name: /advanced/i }))
    await user.type(screen.getByLabelText(/oidc group \(optional\)/i), 'rad-group')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith('Radiology', 'rad-group', null)
  })

  it('calls onDelete when clicking the delete icon', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderModal({ onDelete })

    await user.click(screen.getAllByLabelText('delete program')[0])
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('edits a program name and preserves its OIDC group', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderModal({ onEdit })

    await user.click(screen.getAllByLabelText('edit program')[0])
    const editInput = screen.getByDisplayValue('Medical Lab')
    await user.clear(editInput)
    await user.type(editInput, 'Updated Lab')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith(1, 'Updated Lab', 'mlab-group')
  })

  it('reveals and updates the OIDC group via the Advanced gear in edit mode', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderModal({ onEdit })

    await user.click(screen.getAllByLabelText('edit program')[0])
    await user.click(screen.getByRole('button', { name: /oidc settings/i }))
    const oidcInput = screen.getByDisplayValue('mlab-group')
    await user.clear(oidcInput)
    await user.type(oidcInput, 'new-mlab-group')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith(1, 'Medical Lab', 'new-mlab-group')
  })

  it('displays the OIDC group secondary text for tenant programs that have one', () => {
    renderModal()
    expect(screen.getByText('OIDC group: mlab-group')).toBeInTheDocument()
  })

  it('shows a manage-students button on cohort rows only', async () => {
    const user = userEvent.setup()
    const onManageMembers = vi.fn()
    renderModal({ onManageMembers })

    const btn = screen.getByLabelText('manage students in Cohort A')
    await user.click(btn)
    expect(onManageMembers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, name: 'Cohort A' }),
    )
  })

  it('calls onClose when clicking Close', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ProgramManagementModal — instructor (issue #559)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the cohort title and only lists cohorts under the instructor tenants', () => {
    renderModal({ isAdmin: false, myProgramIds: [1] })
    expect(screen.getByText('Manage Cohorts')).toBeInTheDocument()
    expect(screen.getByText('Cohort A')).toBeInTheDocument()
    // Tenants themselves are not shown to instructors.
    expect(screen.queryByText('Medical Lab')).not.toBeInTheDocument()
    expect(screen.queryByText('Dental Hygiene')).not.toBeInTheDocument()
  })

  it('never exposes any OIDC field to instructors', async () => {
    const user = userEvent.setup()
    renderModal({ isAdmin: false, myProgramIds: [1] })
    expect(screen.queryByRole('button', { name: /advanced/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/oidc/i)).not.toBeInTheDocument()
    // Even in edit mode there is no advanced/OIDC affordance.
    await user.click(screen.getByLabelText('edit program'))
    expect(screen.queryByRole('button', { name: /advanced/i })).not.toBeInTheDocument()
  })

  it('renames a cohort without sending an oidc_group (rename-only)', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderModal({ isAdmin: false, myProgramIds: [1], onEdit })

    await user.click(screen.getByLabelText('edit program'))
    const editInput = screen.getByDisplayValue('Cohort A')
    await user.clear(editInput)
    await user.type(editInput, 'Cohort A2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // undefined => omitted from the PATCH body so the rename-only guard passes.
    expect(onEdit).toHaveBeenCalledWith(3, 'Cohort A2', undefined)
  })

  it('requires a parent tenant before a cohort can be added', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderModal({ isAdmin: false, myProgramIds: [1], onAdd })

    await user.type(screen.getByLabelText(/new cohort name/i), 'Cohort B')
    // No tenant selected yet → still disabled.
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.click(screen.getByRole('combobox'))
    await user.click(within(screen.getByRole('listbox')).getByText('Medical Lab'))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith('Cohort B', null, 1)
  })

  it('only offers tenants the instructor belongs to in the picker', async () => {
    const user = userEvent.setup()
    renderModal({ isAdmin: false, myProgramIds: [1] })

    await user.click(screen.getByRole('combobox'))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByText('Medical Lab')).toBeInTheDocument()
    expect(within(listbox).queryByText('Dental Hygiene')).not.toBeInTheDocument()
  })
})
