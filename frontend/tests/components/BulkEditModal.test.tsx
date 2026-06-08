import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkEditModal from '../../src/components/BulkEditModal'
import type { Program } from '../../src/types'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Dental Hygiene', oidc_group: null, created_at: '', updated_at: '' },
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
    expect(screen.getByText('Bulk Edit Programs')).toBeInTheDocument()
    expect(screen.getByText(/Assign programs to 3 selected people/)).toBeInTheDocument()
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
    expect(screen.getByText(/1 selected person/)).toBeInTheDocument()
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
    expect(onSave).toHaveBeenCalledWith([])
  })

  it('displays overwrite warning text', () => {
    render(
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        programs={programs}
        selectedCount={2}
      />,
    )
    expect(screen.getByText(/will replace any existing program associations/)).toBeInTheDocument()
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
