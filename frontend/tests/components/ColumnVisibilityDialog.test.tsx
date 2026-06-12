import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ColumnVisibilityDialog from '../../src/components/ColumnVisibilityDialog'

type TestColumn = 'name' | 'email' | 'role'

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
] as const satisfies readonly { key: TestColumn, label: string }[]

describe('ColumnVisibilityDialog', () => {
  it('renders the dialog title and all column options', () => {
    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={vi.fn()}
        onToggleColumn={vi.fn()}
      />,
    )

    expect(screen.getByText('Choose columns')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Name' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Email' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Role' })).toBeChecked()
  })

  it('calls onToggleColumn when a checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onToggleColumn = vi.fn()

    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={vi.fn()}
        onToggleColumn={onToggleColumn}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Email' }))

    expect(onToggleColumn).toHaveBeenCalledWith('email')
  })

  it('reflects updated checked state from visibleColumns props', () => {
    const { rerender } = render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={vi.fn()}
        onToggleColumn={vi.fn()}
      />,
    )

    rerender(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: false, email: true, role: true }}
        onClose={vi.fn()}
        onToggleColumn={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Name' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Email' })).toBeChecked()
  })

  it('closes when the Done button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={onClose}
        onToggleColumn={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
