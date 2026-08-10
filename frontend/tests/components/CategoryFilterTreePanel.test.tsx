import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryFilterTreePanel from '../../src/components/CategoryFilterTreePanel'
import { resetCategoryTreeExpansionPreferencesForTests } from '../../src/useCategoryTreeExpansionPreferences'
import { makeCategory } from '../helpers/fixtures'

function makeCategoryTree() {
  return [
    makeCategory({
      id: 1,
      label: 'Architecture',
      children: [
        makeCategory({ id: 4, label: 'American', parentId: 1 }),
        makeCategory({
          id: 3,
          label: 'Italian',
          parentId: 1,
          children: [makeCategory({ id: 5, label: 'Gothic', parentId: 3 })],
        }),
      ],
    }),
    makeCategory({ id: 2, label: 'Panoramas' }),
  ]
}

describe('CategoryFilterTreePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    resetCategoryTreeExpansionPreferencesForTests()
  })

  afterEach(() => {
    resetCategoryTreeExpansionPreferencesForTests()
  })

  it('renders rows indented by depth', () => {
    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    )

    const architectureRow = screen.getByText('Architecture').closest('[role="menuitemcheckbox"]')
    const italianRow = screen.getByText('Italian').closest('[role="menuitemcheckbox"]')

    expect(architectureRow).not.toBeNull()
    expect(italianRow).not.toBeNull()
    expect(architectureRow).toHaveStyle({ paddingLeft: '8px' })
    expect(italianRow).toHaveStyle({ paddingLeft: '32px' })
  })

  it('hides descendants when the shared collapse preference is set', () => {
    localStorage.setItem('hrivpref:category-tree-collapsed:user:1', JSON.stringify([1]))

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('Architecture')).toBeInTheDocument()
    expect(screen.queryByText('Italian')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Architecture' })).toBeInTheDocument()
  })

  it('calls onToggle when a checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={onToggle}
      />,
    )

    const architectureRow = screen.getByText('Architecture').closest('[role="menuitemcheckbox"]')
    expect(architectureRow).not.toBeNull()
    await user.click(within(architectureRow as HTMLElement).getByRole('checkbox'))

    expect(onToggle).toHaveBeenCalledWith(1)
  })

  it('shows an empty-state message when there are no categories', () => {
    render(<CategoryFilterTreePanel categories={[]} selectedIds={new Set()} onToggle={vi.fn()} />)

    expect(screen.getByText('No categories')).toBeInTheDocument()
  })

  it('calls onToggle when the row itself is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={onToggle}
      />,
    )

    await user.click(screen.getByRole('menuitemcheckbox', { name: /Panoramas/ }))

    expect(onToggle).toHaveBeenCalledWith(2)
  })

  it.each([' ', '{Enter}'])('toggles the focused row via keyboard key %j', async (key) => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={onToggle}
      />,
    )

    const row = screen.getByRole('menuitemcheckbox', { name: /Panoramas/ })
    row.focus()
    await user.keyboard(key)

    expect(onToggle).toHaveBeenCalledWith(2)
  })

  it('moves focus with arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    )

    const rows = screen.getAllByRole('menuitemcheckbox')
    rows[0].focus()

    await user.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(rows[0]).toHaveFocus()

    // Wrap upward from the first row to the last
    await user.keyboard('{ArrowUp}')
    expect(rows[rows.length - 1]).toHaveFocus()

    // Wrap downward from the last row to the first
    await user.keyboard('{ArrowDown}')
    expect(rows[0]).toHaveFocus()
  })

  it('moves focus to the first and last rows via Home and End', async () => {
    const user = userEvent.setup()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    )

    const rows = screen.getAllByRole('menuitemcheckbox')
    rows[1].focus()

    await user.keyboard('{End}')
    expect(rows[rows.length - 1]).toHaveFocus()

    await user.keyboard('{Home}')
    expect(rows[0]).toHaveFocus()
  })

  it('collapses and re-expands a subtree via the expand toggle without toggling selection', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set()}
        onToggle={onToggle}
      />,
    )

    expect(screen.getByText('Italian')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse Architecture' }))
    expect(screen.queryByText('Italian')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Architecture' }))
    expect(screen.getByText('Italian')).toBeInTheDocument()

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('reflects selected state from selectedIds', () => {
    render(
      <CategoryFilterTreePanel
        categories={makeCategoryTree()}
        selectedIds={new Set([3])}
        onToggle={vi.fn()}
      />,
    )

    const italianRow = screen.getByText('Italian').closest('[role="menuitemcheckbox"]')
    expect(italianRow).not.toBeNull()
    expect(italianRow).toHaveAttribute('aria-checked', 'true')
    expect(within(italianRow as HTMLElement).getByRole('checkbox')).toBeChecked()
  })
})
