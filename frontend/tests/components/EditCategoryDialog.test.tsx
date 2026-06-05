import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditCategoryDialog from '../../src/components/EditCategoryDialog'
import { ApiError } from '../../src/api'

describe('EditCategoryDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and pre-filled label', () => {
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
      />,
    )
    expect(screen.getByText('Edit Category')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Architecture')).toBeInTheDocument()
  })

  it('Save button is disabled when label is unchanged', () => {
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
      />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('Save button is disabled when label is empty', async () => {
    const user = userEvent.setup()
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
      />,
    )
    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('calls onSave and onClose on successful save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <EditCategoryDialog
        open
        onClose={onClose}
        onSave={onSave}
        currentLabel="Architecture"
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Name', undefined)
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('passes programIds when programs prop is provided', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        currentLabel="Architecture"
        programs={[
          { id: 1, name: 'Admin', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
          { id: 2, name: 'Design', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
        ]}
        currentProgramIds={[2]}
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Name', [2])
    })
  })

  it('shows error on 409 conflict', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new ApiError(409, 'Conflict'))

    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        currentLabel="Architecture"
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'Duplicate')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText('A category with this name already exists at this level'),
      ).toBeInTheDocument()
    })
  })

  it('shows generic error for non-409 failures', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Server error'))

    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        currentLabel="Architecture"
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'Test')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })
  })

  it('shows helper text when an exact sibling match is typed', async () => {
    const user = userEvent.setup()
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
        siblingNames={['Architecture', 'Panoramas', 'Histology']}
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'Panoramas')

    await waitFor(() => {
      expect(screen.getByText('This name already exists at this level')).toBeInTheDocument()
    })
  })

  it('does not show helper text when typing own name', async () => {
    const user = userEvent.setup()
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
        siblingNames={['Architecture', 'Panoramas']}
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    await user.type(input, 'Architecture')

    expect(screen.queryByText('This name already exists at this level')).not.toBeInTheDocument()
  })

  it('Save button disabled when label cleared but programs changed', async () => {
    const user = userEvent.setup()
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
        programs={[
          { id: 1, name: 'Admin', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
          { id: 2, name: 'Design', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
        ]}
        currentProgramIds={[2]}
      />,
    )

    const input = screen.getByDisplayValue('Architecture')
    await user.clear(input)
    // Toggle a program to make programsChanged true
    await user.click(screen.getByText('Admin'))
    // Save should still be disabled because label is empty
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('Save button disabled when specific programs selected but none chosen', async () => {
    const user = userEvent.setup()
    render(
      <EditCategoryDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentLabel="Architecture"
        programs={[
          { id: 1, name: 'Admin', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
          { id: 2, name: 'Design', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
        ]}
        currentProgramIds={[2]}
      />,
    )

    // Deselect "Design" so no programs are selected under "Specific programs"
    await user.click(screen.getByText('Design'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // ─── Inherited program restriction logic ──────────────────────────

  describe('child program picker restriction', () => {
    const allPrograms = [
      { id: 1, name: 'Program A', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
      { id: 2, name: 'Program B', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
      { id: 3, name: 'Program C', oidc_group: null, parent_program_id: null, is_cohort: false, created_at: '', updated_at: '' },
    ]

    it('disables programs not in the inherited set', () => {
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[]}
          inheritedProgramIds={[1, 2]}
        />,
      )
      // "Specific programs" is auto-selected when inheritedProgramIds exist

      const chipA = screen.getByText('Program A').closest('.MuiChip-root')!
      const chipB = screen.getByText('Program B').closest('.MuiChip-root')!
      const chipC = screen.getByText('Program C').closest('.MuiChip-root')!

      expect(chipA).not.toHaveClass('Mui-disabled')
      expect(chipB).not.toHaveClass('Mui-disabled')
      expect(chipC).toHaveClass('Mui-disabled')
    })

    it('filters out invalid selections on dialog open', () => {
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[1, 3]}
          inheritedProgramIds={[1, 2]}
        />,
      )
      // "Specific programs" should be pre-selected since currentProgramIds is non-empty
      const chipA = screen.getByText('Program A').closest('.MuiChip-root')!
      const chipC = screen.getByText('Program C').closest('.MuiChip-root')!

      // Program A (id=1) is valid and should be selected (filled)
      expect(chipA).toHaveClass('MuiChip-filled')

      // Program C (id=3) is NOT in inherited set — should not be selected
      expect(chipC).not.toHaveClass('MuiChip-filled')
    })

    it('allows toggling programs within the inherited set', async () => {
      const user = userEvent.setup()
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[1]}
          inheritedProgramIds={[1, 2]}
        />,
      )

      const chipB = screen.getByText('Program B').closest('.MuiChip-root')!
      await user.click(chipB)

      // After clicking, Program B should now be selected (filled)
      expect(chipB).toHaveClass('MuiChip-filled')
    })

    it('does not allow toggling disabled programs', () => {
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[]}
          inheritedProgramIds={[1, 2]}
        />,
      )
      // "Specific programs" is auto-selected when inheritedProgramIds exist

      // Program C should be disabled (pointer-events: none prevents clicks)
      const chipC = screen.getByText('Program C').closest('.MuiChip-root')!
      expect(chipC).toHaveClass('Mui-disabled')
      expect(chipC).not.toHaveClass('MuiChip-filled')
    })

    it('saves only valid inherited programs', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)

      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={onSave}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[1, 3]}
          inheritedProgramIds={[1, 2]}
        />,
      )

      // Change label to enable Save (since invalid programs were filtered,
      // programsChanged is true but let's also change label for clarity)
      const input = screen.getByDisplayValue('Child')
      await user.clear(input)
      await user.type(input, 'Updated Child')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        // Should save [1] only — Program C (id=3) was filtered out on open
        expect(onSave).toHaveBeenCalledWith('Updated Child', [1])
      })
    })

    it('shows all programs as enabled when no inherited restrictions exist', () => {
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="TopLevel"
          programs={allPrograms}
          currentProgramIds={[]}
          inheritedProgramIds={[]}
        />,
      )
      screen.getByLabelText('Specific programs').click()

      const chipA = screen.getByText('Program A').closest('.MuiChip-root')!
      const chipB = screen.getByText('Program B').closest('.MuiChip-root')!
      const chipC = screen.getByText('Program C').closest('.MuiChip-root')!

      expect(chipA).not.toHaveClass('Mui-disabled')
      expect(chipB).not.toHaveClass('Mui-disabled')
      expect(chipC).not.toHaveClass('Mui-disabled')
    })

    it('defaults to specific-programs view when inherited restrictions exist', () => {
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[]}
          inheritedProgramIds={[1, 2]}
        />,
      )
      // Should auto-select "Specific programs" when inheritedProgramIds exist
      expect(screen.getByLabelText('Specific programs')).toBeChecked()

      // Inherited programs should render at 0.5 opacity (not selected as own)
      const chipA = screen.getByText('Program A').closest('.MuiChip-root')!
      const chipB = screen.getByText('Program B').closest('.MuiChip-root')!
      expect(chipA).toHaveStyle({ opacity: '0.5' })
      expect(chipB).toHaveStyle({ opacity: '0.5' })
      // Both should be filled primary
      expect(chipA).toHaveClass('MuiChip-filled')
      expect(chipB).toHaveClass('MuiChip-filled')
    })

    it('allows saving label change with inherited-only programs (no own selection)', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(
        <EditCategoryDialog
          open
          onClose={vi.fn()}
          onSave={onSave}
          currentLabel="Child"
          programs={allPrograms}
          currentProgramIds={[]}
          inheritedProgramIds={[1, 2]}
        />,
      )
      // Change label — Save should be enabled even with 0 own selections
      const input = screen.getByDisplayValue('Child')
      await user.clear(input)
      await user.type(input, 'Renamed Child')
      const saveBtn = screen.getByRole('button', { name: 'Save' })
      expect(saveBtn).not.toBeDisabled()
      await user.click(saveBtn)
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('Renamed Child', [])
      })
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <EditCategoryDialog
        open
        onClose={onClose}
        onSave={vi.fn()}
        currentLabel="Architecture"
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
