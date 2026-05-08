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
    expect(screen.getByText('Rename Category')).toBeInTheDocument()
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
      expect(onSave).toHaveBeenCalledWith('New Name')
    })
    expect(onClose).toHaveBeenCalled()
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
