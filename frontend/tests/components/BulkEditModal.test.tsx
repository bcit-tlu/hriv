import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        selectedCount={2}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const savingButton = await screen.findByRole('button', { name: /Saving/ })
    expect(savingButton).toBeDisabled()
    // Cancel stays enabled so a hung request can never trap the user
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()

    // The disabled button ignores further clicks, so no second save fires
    fireEvent.click(savingButton)
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave()
    })
    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled()
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
      <BulkEditModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        programs={programs}
        selectedCount={2}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Medical Lab' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Dismiss mid-flight, then make a new selection (as after reopening)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Dental Hygiene' }))
    await user.keyboard('{Escape}')

    // The old save settling must not wipe the new selection or saving state
    await act(async () => {
      resolveSave()
    })
    expect(screen.getByText('Dental Hygiene')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
