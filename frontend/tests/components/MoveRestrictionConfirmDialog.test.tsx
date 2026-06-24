import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveRestrictionConfirmDialog from '../../src/components/MoveRestrictionConfirmDialog'
import type { MoveRestrictionChange } from '../../src/categoryUtils'
import type { Group, Program } from '../../src/types'

const programs: Program[] = [
  { id: 1, name: 'Biology', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Chemistry', oidc_group: null, created_at: '', updated_at: '' },
]

const groups: Group[] = [
  {
    id: 10,
    name: 'Group A',
    description: null,
    createdByUserId: null,
    memberIds: [],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
]

function makeChange(overrides: Partial<MoveRestrictionChange> = {}): MoveRestrictionChange {
  return {
    hasChange: true,
    oldEffectiveProgramIds: [],
    oldProgramsInitialized: false,
    newEffectiveProgramIds: [],
    newProgramsInitialized: false,
    oldEffectiveGroupIds: [],
    oldGroupsInitialized: false,
    newEffectiveGroupIds: [],
    newGroupsInitialized: false,
    ...overrides,
  }
}

describe('MoveRestrictionConfirmDialog', () => {
  it('renders category and destination labels', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="Category C"
        destinationLabel="Category A"
        change={makeChange()}
      />,
    )
    expect(screen.getByText(/Category C/)).toBeInTheDocument()
    expect(screen.getByText(/Category A/)).toBeInTheDocument()
  })

  it('calls onConfirm when Move Anyway is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveProgramIds: [1], newEffectiveProgramIds: [] })}
        programs={programs}
      />,
    )
    await user.click(screen.getByRole('button', { name: /move anyway/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={onCancel}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows program restriction section with names when programs change', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveProgramIds: [1, 2], newEffectiveProgramIds: [] })}
        programs={programs}
      />,
    )
    expect(screen.getByText('Program restriction')).toBeInTheDocument()
    expect(screen.getByText('Biology')).toBeInTheDocument()
    expect(screen.getByText('Chemistry')).toBeInTheDocument()
    expect(screen.getAllByText(/unrestricted/i).length).toBeGreaterThan(0)
  })

  it('distinguishes conflicting empty program intersections from unrestricted access', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({
          oldEffectiveProgramIds: [],
          oldProgramsInitialized: false,
          newEffectiveProgramIds: [],
          newProgramsInitialized: true,
        })}
      />,
    )
    expect(screen.getByText('Unrestricted (all programs)')).toBeInTheDocument()
    expect(screen.getByText('No programs (conflicting restrictions)')).toBeInTheDocument()
  })

  it('shows group restriction section with names when groups change', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveGroupIds: [10], newEffectiveGroupIds: [] })}
        groups={groups}
      />,
    )
    expect(screen.getByText('Group restriction')).toBeInTheDocument()
    expect(screen.getByText('Group A')).toBeInTheDocument()
  })

  it('distinguishes conflicting empty group intersections from unrestricted access', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({
          oldEffectiveGroupIds: [],
          oldGroupsInitialized: false,
          newEffectiveGroupIds: [],
          newGroupsInitialized: true,
        })}
      />,
    )
    expect(screen.getByText('Unrestricted (all groups)')).toBeInTheDocument()
    expect(screen.getByText('No groups (conflicting restrictions)')).toBeInTheDocument()
  })

  it('does not show program section when programs are unchanged', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveProgramIds: [1], newEffectiveProgramIds: [1] })}
        programs={programs}
      />,
    )
    expect(screen.queryByText('Program restriction')).not.toBeInTheDocument()
  })

  it('does not show group section when groups are unchanged', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveGroupIds: [10], newEffectiveGroupIds: [10] })}
        groups={groups}
      />,
    )
    expect(screen.queryByText('Group restriction')).not.toBeInTheDocument()
  })

  it('shows resolved-change state when restrictions no longer change', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ hasChange: false })}
      />,
    )

    expect(screen.getByText(/no longer changes effective access restrictions/i)).toBeInTheDocument()
    expect(screen.getByText(/Restrictions are no longer affected/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^move$/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('falls back to ID string when program is not in programs list', () => {
    render(
      <MoveRestrictionConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        categoryLabel="C"
        destinationLabel="A"
        change={makeChange({ oldEffectiveProgramIds: [999], newEffectiveProgramIds: [] })}
        programs={[]}
      />,
    )
    expect(screen.getByText('999')).toBeInTheDocument()
  })
})
