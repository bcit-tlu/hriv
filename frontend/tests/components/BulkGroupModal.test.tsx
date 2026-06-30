import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkGroupModal from '../../src/components/BulkGroupModal'
import type { Group } from '../../src/types'

const groups: Group[] = [
  { id: 7, name: 'Lab A2', description: null, created_at: '', updated_at: '' },
  { id: 8, name: 'Lab B1', description: null, created_at: '', updated_at: '' },
]

describe('BulkGroupModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and person count', () => {
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={vi.fn()} groups={groups} selectedCount={3} />,
    )
    expect(screen.getByText('Bulk Add to Groups')).toBeInTheDocument()
    expect(screen.getByText(/3 selected people/)).toBeInTheDocument()
  })

  it('Add to Groups button is disabled when no group selected', () => {
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={vi.fn()} groups={groups} selectedCount={1} />,
    )
    expect(screen.getByRole('button', { name: 'Add to Groups' })).toBeDisabled()
  })

  it('calls onSave with selected group ids', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={onSave} groups={groups} selectedCount={2} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    expect(onSave).toHaveBeenCalledWith([7])
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <BulkGroupModal open onClose={onClose} onSave={vi.fn()} groups={groups} selectedCount={1} />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('resets selection after save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={onSave} groups={groups} selectedCount={1} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab B1' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    expect(onSave).toHaveBeenCalledWith([8])
    // After save the internal state resets — button should be disabled again
    expect(screen.getByRole('button', { name: 'Add to Groups' })).toBeDisabled()
  })
})
