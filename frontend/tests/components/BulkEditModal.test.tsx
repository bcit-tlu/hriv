import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkEditModal from '../../src/components/BulkEditModal'
import type { Program } from '../../src/types'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', created_at: '', updated_at: '' },
  { id: 2, name: 'Dental Hygiene', created_at: '', updated_at: '' },
]

describe('BulkEditModal', () => {
  it('renders title and shows selected count', () => {
    render(
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
        selectedCount={3}
      />,
    )
    expect(screen.getByText('Bulk Edit Program')).toBeInTheDocument()
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    expect(screen.getByText(/people/)).toBeInTheDocument()
  })

  it('shows singular "person" when selectedCount is 1', () => {
    render(
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
        selectedCount={1}
      />,
    )
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
    expect(screen.getByText(/person/)).toBeInTheDocument()
  })

  it('calls onSave with null when no program is selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        selectedCount={2}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('cancel calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <BulkEditModal
        open
        onClose={onClose}
        onSave={vi.fn()}
        programs={programs}
        selectedCount={1}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
