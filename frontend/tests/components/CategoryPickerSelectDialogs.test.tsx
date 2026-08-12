/**
 * CategoryPickerSelect add/edit dialog flows.
 *
 * Covers the dialog wiring that the base CategoryPickerSelect suite does not:
 * opening AddCategoryDialog from the root and per-category "+" buttons,
 * selecting a newly created category, and the EditCategoryDialog save path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryPickerSelect from '../../src/components/CategoryPickerSelect'
import { resetCategoryTreeExpansionPreferencesForTests } from '../../src/useCategoryTreeExpansionPreferences'
import { makeCategory } from '../helpers/fixtures'

beforeEach(() => {
  localStorage.clear()
  resetCategoryTreeExpansionPreferencesForTests()
})

afterEach(() => {
  resetCategoryTreeExpansionPreferencesForTests()
})

describe('CategoryPickerSelect — add category dialog', () => {
  it('adds a child under a category and selects the newly created id', async () => {
    const user = userEvent.setup()
    const onAddCategory = vi.fn().mockResolvedValue(99)
    const onChange = vi.fn()
    const categories = [makeCategory({ id: 1, label: 'Parent' })]

    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const parentOption = screen.getByRole('option', { name: /Parent/ })
    const addBtn = within(parentOption)
      .getAllByRole('button')
      .find((btn) => btn.querySelector('svg[data-testid="AddIcon"]'))
    expect(addBtn).toBeDefined()
    await user.click(addBtn!)

    expect(screen.getByText('New Category in Parent')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Category name'), 'Child cat')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onAddCategory).toHaveBeenCalledWith('Child cat', 1, [], []))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(99))
  })

  it('adds a root-level category via the root menu item add button', async () => {
    const user = userEvent.setup()
    const onAddCategory = vi.fn().mockResolvedValue(undefined)
    const onChange = vi.fn()
    const categories = [makeCategory({ id: 1, label: 'Parent' })]

    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const rootOption = screen.getByRole('option', { name: /None \(root level\)/ })
    const rootAddBtn = within(rootOption)
      .getAllByRole('button')
      .find((btn) => btn.querySelector('svg[data-testid="AddIcon"]'))
    expect(rootAddBtn).toBeDefined()
    await user.click(rootAddBtn!)

    await user.type(screen.getByLabelText('Category name'), 'Top level')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onAddCategory).toHaveBeenCalledWith('Top level', null, [], []))
    // No numeric id returned: the selection must not change.
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CategoryPickerSelect — edit category dialog', () => {
  it('opens the edit dialog and saves a rename through onEditCategory', async () => {
    const user = userEvent.setup()
    const onEditCategory = vi.fn().mockResolvedValue(undefined)
    const categories = [makeCategory({ id: 7, label: 'Old name' })]

    render(
      <CategoryPickerSelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        onEditCategory={onEditCategory}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const editBtn = screen
      .getAllByRole('button')
      .find((btn) => btn.querySelector('svg[data-testid="EditIcon"]'))
    expect(editBtn).toBeDefined()
    await user.click(editBtn!)

    const input = screen.getByDisplayValue('Old name')
    await user.clear(input)
    await user.type(input, 'New name')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onEditCategory).toHaveBeenCalledWith(7, 'New name', undefined, undefined, undefined),
    )
  })
})
