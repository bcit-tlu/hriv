import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkGroupModal from '../../src/components/BulkGroupModal'
import type { Group } from '../../src/types'

const groups: Group[] = [
  {
    id: 7,
    name: 'Lab A2',
    description: null,
    createdByUserId: null,
    memberIds: [],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 8,
    name: 'Lab B1',
    description: null,
    createdByUserId: null,
    memberIds: [],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
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

  it('disables actions and shows saving state while onSave is in flight', async () => {
    const user = userEvent.setup()
    let resolveSave: () => void = () => {}
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={onSave} groups={groups} selectedCount={1} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    const savingButton = await screen.findByRole('button', { name: /Adding/ })
    expect(savingButton).toBeDisabled()
    // Cancel stays enabled so a hung request can never trap the user
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()

    // The disabled button ignores further clicks, so no second save fires
    fireEvent.click(savingButton)
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave()
    })
    expect(await screen.findByRole('button', { name: 'Add to Groups' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('does not let a stale in-flight save clobber a newer selection after dismissal', async () => {
    const user = userEvent.setup()
    let resolveSave: () => void = () => {}
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={onSave} groups={groups} selectedCount={1} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    // Dismiss mid-flight, then make a new selection (as after reopening)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab B1' }))
    await user.keyboard('{Escape}')

    // The old save settling must not wipe the new selection or saving state
    await act(async () => {
      resolveSave()
    })
    expect(screen.getByText('Lab B1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Groups' })).toBeEnabled()
  })

  it('prunes succeeded groups from the selection when onSave reports failures', async () => {
    const user = userEvent.setup()
    // Lab A2 (7) succeeds; Lab B1 (8) fails
    const onSave = vi.fn().mockResolvedValue([8])
    render(
      <BulkGroupModal open onClose={vi.fn()} onSave={onSave} groups={groups} selectedCount={1} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Lab A2' }))
    await user.click(screen.getByRole('option', { name: 'Lab B1' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add to Groups' }))

    expect(onSave).toHaveBeenCalledWith([7, 8])
    // Only the failed group remains selected for retry
    expect(await screen.findByText('Lab B1')).toBeInTheDocument()
    expect(screen.queryByText('Lab A2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Groups' })).toBeEnabled()
  })
})
