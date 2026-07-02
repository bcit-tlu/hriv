/**
 * Unit tests for the AddCategoryDialog component.
 *
 * Covers:
 * 1. Renders dialog title with parent label or default
 * 2. Clicking "Create" calls onAdd and onClose with trimmed label
 * 3. Pressing Enter calls onAdd and onClose with trimmed label
 * 4. Pressing Enter does not propagate the keydown event
 * 5. Empty input prevents submission via Create button (disabled)
 * 6. Empty input prevents submission via Enter key
 * 7. Clicking "Cancel" calls onClose without calling onAdd
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import AddCategoryDialog from '../../src/components/AddCategoryDialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(
  props: Partial<Parameters<typeof AddCategoryDialog>[0]> = {},
  authValue: AuthContextValue | null = null,
) {
  const onClose = props.onClose ?? vi.fn()
  const onAdd = props.onAdd ?? vi.fn()
  const dialog = (
    <AddCategoryDialog
      open={true}
      onClose={onClose}
      onAdd={onAdd}
      parentLabel={props.parentLabel}
      siblingNames={props.siblingNames}
      programs={props.programs}
      inheritedProgramIds={props.inheritedProgramIds}
      groups={props.groups}
      inheritedGroupIds={props.inheritedGroupIds}
    />
  )
  const result = render(
    authValue ? <AuthContext.Provider value={authValue}>{dialog}</AuthContext.Provider> : dialog,
  )
  return { ...result, onClose, onAdd }
}

const GROUPS = [
  {
    id: 10,
    name: 'Cohort A',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 11,
    name: 'Cohort B',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '',
    updatedAt: '',
  },
]

function getCategoryInput() {
  return screen.getByLabelText('Category name')
}

function getCreateButton() {
  return screen.getByRole('button', { name: 'Create' })
}

function getCancelButton() {
  return screen.getByRole('button', { name: 'Cancel' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AddCategoryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Rendering ---

  it('renders the dialog title with parent label', () => {
    renderDialog({ parentLabel: 'Panoramas' })
    expect(screen.getByText('New Category in Panoramas')).toBeInTheDocument()
  })

  it('renders default title when no parent label', () => {
    renderDialog()
    expect(screen.getByText('New Category')).toBeInTheDocument()
  })

  // --- Create button ---

  it('calls onAdd and onClose when Create button is clicked', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), '  Histology  ')
    await user.click(getCreateButton())

    expect(onAdd).toHaveBeenCalledWith('Histology', [], [])
    expect(onClose).toHaveBeenCalled()
  })

  it('disables Create button when input is empty', () => {
    renderDialog()
    expect(getCreateButton()).toBeDisabled()
  })

  // --- Enter key ---

  it('calls onAdd and onClose when Enter is pressed', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), 'Pathology')
    await user.keyboard('{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Pathology', [], [])
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onAdd when Enter is pressed with empty input', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    getCategoryInput().focus()
    await user.keyboard('{Enter}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prevents Enter keydown event from propagating', async () => {
    const user = userEvent.setup()
    const outerKeyDown = vi.fn()
    const onAdd = vi.fn()
    const onClose = vi.fn()

    const { container } = render(
      <div onKeyDown={outerKeyDown}>
        <AddCategoryDialog open={true} onClose={onClose} onAdd={onAdd} parentLabel={undefined} />
      </div>,
    )

    const input = screen.getByLabelText('Category name')
    await user.type(input, 'Test')
    await user.keyboard('{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Test', [], [])
    // The outer div should NOT receive the Enter keydown thanks to stopPropagation
    const enterEvents = outerKeyDown.mock.calls.filter(
      (call: [KeyboardEvent]) => call[0].key === 'Enter',
    )
    expect(enterEvents).toHaveLength(0)

    container.remove()
  })

  // --- Pre-populate parent program restrictions ---

  it('defaults to "Specific programs" with inherited programs pre-selected', async () => {
    const programs = [
      { id: 1, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' },
      { id: 2, name: 'Dental', oidc_group: null, created_at: '', updated_at: '' },
      { id: 3, name: 'Radiology', oidc_group: null, created_at: '', updated_at: '' },
    ]
    renderDialog({ programs, inheritedProgramIds: [1, 3] })

    expect(screen.getByLabelText('Specific programs')).toBeChecked()
    // Inherited programs should be pre-selected (filled chips)
    const nursingChip = screen.getByText('Nursing')
    const radiologyChip = screen.getByText('Radiology')
    expect(nursingChip).toBeInTheDocument()
    expect(radiologyChip).toBeInTheDocument()
  })

  it('submits inherited program IDs when user creates without changing selection', async () => {
    const user = userEvent.setup()
    const programs = [
      { id: 1, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' },
      { id: 2, name: 'Dental', oidc_group: null, created_at: '', updated_at: '' },
    ]
    const { onAdd } = renderDialog({ programs, inheritedProgramIds: [1, 2] })

    await user.type(getCategoryInput(), 'Subcategory')
    await user.click(getCreateButton())

    expect(onAdd).toHaveBeenCalledWith('Subcategory', expect.arrayContaining([1, 2]), [])
  })

  it('defaults to "All students" when no inherited programs', () => {
    const programs = [{ id: 1, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' }]
    renderDialog({ programs, inheritedProgramIds: [] })

    expect(screen.getByLabelText('All students')).toBeChecked()
  })

  it('disables non-member program chips and shows the membership caption', () => {
    const programs = [
      { id: 1, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' },
      { id: 2, name: 'Dental', oidc_group: null, created_at: '', updated_at: '' },
    ]
    const authValue = {
      currentUser: {
        id: 1,
        name: 'Instructor',
        email: 'inst@example.com',
        role: 'instructor',
        program_ids: [1],
        program_names: ['Nursing'],
        group_ids: [],
        group_names: [],
      },
      users: [],
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      addUser: vi.fn(),
      deleteUser: vi.fn(),
      refreshUsers: vi.fn(),
      canManageUsers: false,
      canEditContent: true,
      oidcError: null,
      clearOidcError: vi.fn(),
    } as unknown as AuthContextValue

    renderDialog({ programs, inheritedProgramIds: [1] }, authValue)

    expect(screen.getByText('Nursing').closest('.MuiChip-root')).not.toHaveClass('Mui-disabled')
    expect(screen.getByText('Dental').closest('.MuiChip-root')).toHaveClass('Mui-disabled')
    expect(screen.getByText('You can only restrict to programs you belong to.')).toBeInTheDocument()
  })

  // --- Group restriction section ---

  it('does not render the group section when no groups are provided', () => {
    renderDialog()
    expect(screen.queryByText('Group restriction')).not.toBeInTheDocument()
  })

  it('renders the group section and defaults to "All groups"', () => {
    renderDialog({ groups: GROUPS })
    expect(screen.getByText('Group restriction')).toBeInTheDocument()
    expect(screen.getByLabelText('All groups')).toBeChecked()
  })

  it('passes selected groupIds to onAdd', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderDialog({ groups: GROUPS })

    await user.type(getCategoryInput(), 'Restricted')
    await user.click(screen.getByLabelText('Specific groups'))
    await user.click(screen.getByText('Cohort A'))
    await user.click(getCreateButton())

    expect(onAdd).toHaveBeenCalledWith('Restricted', [], [10])
  })

  it('pre-selects inherited groups and submits them', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderDialog({ groups: GROUPS, inheritedGroupIds: [11] })

    expect(screen.getByLabelText('Specific groups')).toBeChecked()
    await user.type(getCategoryInput(), 'Child')
    await user.click(getCreateButton())

    expect(onAdd).toHaveBeenCalledWith('Child', [], expect.arrayContaining([11]))
  })

  it('shows the symmetric intersection warning when both program and group restricted', async () => {
    const user = userEvent.setup()
    const programs = [{ id: 1, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' }]
    renderDialog({ programs, groups: GROUPS })

    expect(screen.queryByText(/restricted by both program and group/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Specific programs'))
    await user.click(screen.getByText('Nursing'))
    await user.click(screen.getByLabelText('Specific groups'))
    await user.click(screen.getByText('Cohort A'))

    expect(screen.getByText(/restricted by both program and group/i)).toBeInTheDocument()
  })

  // --- Cancel ---

  it('calls onClose without onAdd when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), 'Something')
    await user.click(getCancelButton())

    expect(onClose).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
