import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ColumnVisibilityDialog from '../../src/components/ColumnVisibilityDialog'

type TestColumn = 'name' | 'email' | 'role'

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
] as const satisfies readonly { key: TestColumn; label: string }[]

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

  it('prevents hiding the last visible column', async () => {
    const onToggleColumn = vi.fn()

    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: false }}
        onClose={vi.fn()}
        onToggleColumn={onToggleColumn}
      />,
    )

    const nameCheckbox = screen.getByRole('checkbox', { name: 'Name' })
    expect(nameCheckbox).toBeChecked()
    expect(nameCheckbox).toBeDisabled()
    expect(onToggleColumn).not.toHaveBeenCalled()
  })

  it('renders a drag handle for each column when onReorderColumns is provided', () => {
    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={vi.fn()}
        onToggleColumn={vi.fn()}
        onReorderColumns={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Reorder Name column' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Email column' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Role column' })).toBeInTheDocument()
    expect(screen.getByText(/Drag to reorder columns/)).toBeInTheDocument()
  })

  it('does not render drag handles when onReorderColumns is omitted', () => {
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

    expect(screen.queryByRole('button', { name: /Reorder .* column/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Drag to reorder columns/)).not.toBeInTheDocument()
  })

  it('still toggles column visibility in reorderable mode', async () => {
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
        onReorderColumns={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Email' }))

    expect(onToggleColumn).toHaveBeenCalledWith('email')
  })

  it('calls onReorderColumns with the new order after a keyboard reorder', async () => {
    const user = userEvent.setup()
    const onReorderColumns = vi.fn()

    render(
      <ColumnVisibilityDialog<TestColumn>
        open
        title="Choose columns"
        columns={columns}
        visibleColumns={{ name: true, email: false, role: true }}
        onClose={vi.fn()}
        onToggleColumn={vi.fn()}
        onReorderColumns={onReorderColumns}
      />,
    )

    // jsdom rects are all 0×0, and @dnd-kit's keyboard plugin skips
    // zero-size drop targets — give each sortable row deterministic
    // geometry so ArrowDown can resolve the row below it. Ancestors get
    // stubbed too: getVisibleBoundingRectangle clips rows against any
    // non-visible-overflow ancestor (e.g. the scrollable DialogContent),
    // whose zero rect would otherwise collapse the row rect.
    const stubRect = (el: Element, rect: Omit<DOMRect, 'toJSON'>) =>
      vi.spyOn(el as HTMLElement, 'getBoundingClientRect').mockReturnValue({
        ...rect,
        toJSON: () => rect,
      } as DOMRect)
    const ancestorRect = {
      top: 0,
      bottom: 500,
      left: 0,
      right: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
    }
    const handles = ['Name', 'Email', 'Role'].map((label) =>
      screen.getByRole('button', { name: `Reorder ${label} column` }),
    )
    handles.forEach((handle, index) => {
      const row = handle.parentElement!
      stubRect(row, {
        top: index * 40,
        bottom: index * 40 + 40,
        left: 0,
        right: 400,
        width: 400,
        height: 40,
        x: 0,
        y: index * 40,
      })
      for (
        let el = row.parentElement;
        el && el !== document.documentElement;
        el = el.parentElement
      ) {
        stubRect(el, ancestorRect)
      }
    })

    // Enter is one of @dnd-kit's start/end keyCodes (userEvent's {Space}
    // descriptor emits code 'Unknown', so a literal space can't be used).
    handles[0].focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onReorderColumns).toHaveBeenCalledWith(['email', 'name', 'role'])
  })
})
