/**
 * Unit tests for CategoryPickerSelect LockIcon behavior.
 *
 * Covers:
 * 1. LockIcon renders for restricted categories
 * 2. LockIcon is wrapped in a semantic span with aria-label
 * 3. Inherited restriction shows correct aria-label
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryPickerSelect from '../../src/components/CategoryPickerSelect'
import { makeCategory, makeImage } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoryPickerSelect — LockIcon', () => {
  it('renders LockIcon for a category with programIds', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Restricted', programIds: [10] })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    // Open the select dropdown
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByLabelText('Restricted to specific programs')).toBeInTheDocument()
  })

  it('wraps LockIcon in a semantic span with aria-label for screen readers', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Restricted', programIds: [10] })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    const lockElement = screen.getByLabelText('Restricted to specific programs')
    expect(lockElement).toHaveAttribute('role', 'img')
  })

  it('displays "None (root level)" when root is selected (value=null)', () => {
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('None (root level)')).toBeInTheDocument()
  })

  it('displays placeholder text when provided and value is null', () => {
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        placeholder="(no change)"
      />,
    )
    expect(screen.getByText('(no change)')).toBeInTheDocument()
    expect(screen.queryByText('None (root level)')).not.toBeInTheDocument()
  })

  it('displays "None (root level)" after selecting root when placeholder was shown', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    const onChange = vi.fn()
    const { rerender } = render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={onChange}
        placeholder="(no change)"
      />,
    )
    // Initially shows placeholder
    expect(screen.getByText('(no change)')).toBeInTheDocument()

    // Open dropdown and select root option
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('None (root level)'))

    // Simulate parent state update: value stays null but placeholder removed
    rerender(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={onChange}
      />,
    )
    expect(screen.getByText('None (root level)')).toBeInTheDocument()
    expect(screen.queryByText('(no change)')).not.toBeInTheDocument()
  })

  it('shrinks the input label when root option is displayed', () => {
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    const label = document.querySelector('label')
    expect(label).toHaveAttribute('data-shrink', 'true')
  })

  it('shrinks the input label when placeholder is displayed', () => {
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        placeholder="(no change)"
      />,
    )
    const label = document.querySelector('label')
    expect(label).toHaveAttribute('data-shrink', 'true')
  })

  it('displays selected category label in the collapsed select', () => {
    const categories = [makeCategory({ id: 5, label: 'Histology' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={5}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Histology')).toBeInTheDocument()
  })

  it('shows non-excluded categories in dropdown when excludeCategoryId is set', async () => {
    const user = userEvent.setup()
    const categories = [
      makeCategory({ id: 1, label: 'Skills 1', children: [
        makeCategory({ id: 2, label: 'Sub A', parentId: 1 }),
      ] }),
      makeCategory({ id: 3, label: 'Skills 2' }),
    ]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        excludeCategoryId={1}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    // Skills 1 and Sub A excluded; Skills 2 still visible
    expect(screen.queryByText('Skills 1')).not.toBeInTheDocument()
    expect(screen.queryByText(/Sub A/)).not.toBeInTheDocument()
    expect(screen.getByText('Skills 2')).toBeInTheDocument()
  })

  it('renders inherited restriction tooltip for child categories', async () => {
    const user = userEvent.setup()
    const parent = makeCategory({
      id: 1,
      label: 'Parent',
      programIds: [10],
      children: [
        makeCategory({ id: 2, label: 'Child', parentId: 1, programIds: [] }),
      ],
    })
    render(
      <CategoryPickerSelect
        categories={[parent]}
        value={null}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByLabelText('Restricted to specific programs')).toBeInTheDocument()
    expect(screen.getByLabelText('Program restriction inherited from parent')).toBeInTheDocument()
  })

  it('renders a secondary lock icon for direct group restrictions', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Grouped', groupIds: [20] })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByLabelText('Restricted to specific groups')).toBeInTheDocument()
  })

  it('renders inherited group restriction tooltip for child categories', async () => {
    const user = userEvent.setup()
    const parent = makeCategory({
      id: 1,
      label: 'Parent',
      groupIds: [20],
      children: [
        makeCategory({ id: 2, label: 'Child', parentId: 1, groupIds: [] }),
      ],
    })
    render(
      <CategoryPickerSelect
        categories={[parent]}
        value={null}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByLabelText('Restricted to specific groups')).toBeInTheDocument()
    expect(screen.getByLabelText('Group restriction inherited from parent')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — onChange behavior
// ---------------------------------------------------------------------------

describe('CategoryPickerSelect — onChange', () => {
  it('fires onChange with category id when a category is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const categories = [makeCategory({ id: 5, label: 'Histology' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Histology'))
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('fires onChange with null when root option is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const categories = [makeCategory({ id: 5, label: 'Histology' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={5}
        onChange={onChange}
        includeRoot
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('None (root level)'))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

// ---------------------------------------------------------------------------
// Tests — includeRoot=false
// ---------------------------------------------------------------------------

describe('CategoryPickerSelect — includeRoot=false', () => {
  it('does not show "None (root level)" option when includeRoot is false', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Test' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        includeRoot={false}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByText('None (root level)')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — Empty categories
// ---------------------------------------------------------------------------

describe('CategoryPickerSelect — empty state', () => {
  it('shows "No other categories available" when excludeCategoryId filters everything', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Only' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        excludeCategoryId={1}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('No other categories available')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — action buttons (add, edit, delete, toggle visibility)
// ---------------------------------------------------------------------------

describe('CategoryPickerSelect — action buttons', () => {
  it('renders add button on category items when onAddCategory is provided', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Cat1' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onAddCategory={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    const addButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg[data-testid="AddIcon"]'),
    )
    expect(addButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders edit button on category items when onEditCategory is provided', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Cat1' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onEditCategory={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(
      screen.getAllByRole('button').some(
        (btn) => btn.querySelector('svg[data-testid="EditIcon"]'),
      ),
    ).toBe(true)
  })

  it('renders delete button on category items when onDeleteCategory is provided', async () => {
    const user = userEvent.setup()
    const onDeleteCategory = vi.fn().mockResolvedValue(undefined)
    const categories = [makeCategory({ id: 42, label: 'Cat1' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onDeleteCategory={onDeleteCategory}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    const deleteBtn = screen.getAllByRole('button').find(
      (btn) => btn.querySelector('svg[data-testid="DeleteIcon"]'),
    )
    expect(deleteBtn).toBeDefined()
    await user.click(deleteBtn!)
    expect(onDeleteCategory).toHaveBeenCalledWith(42)
  })

  it('renders visibility toggle when onToggleVisibility is provided', async () => {
    const user = userEvent.setup()
    const onToggleVisibility = vi.fn().mockResolvedValue(undefined)
    const categories = [makeCategory({ id: 7, label: 'Cat1' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onToggleVisibility={onToggleVisibility}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    const visBtn = screen.getByLabelText('Visibility: Hide category')
    await user.click(visBtn)
    expect(onToggleVisibility).toHaveBeenCalledWith(7)
  })

  it('shows "Show category" label for hidden categories', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Hidden', status: 'hidden' })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onToggleVisibility={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByLabelText('Visibility: Show category')).toBeInTheDocument()
  })

  it('renders image count next to category name', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({
      id: 1,
      label: 'Cat1',
      images: [makeImage({ id: 1 }), makeImage({ id: 2 }), makeImage({ id: 3 })],
    })]
    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })
})
