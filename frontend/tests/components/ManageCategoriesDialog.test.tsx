/**
 * Unit tests for ManageCategoriesDialog.
 *
 * Covers:
 * 1. LockIcon renders for restricted categories
 * 2. LockIcon click opens edit dialog when onEditCategory is provided
 * 3. LockIcon is non-interactive (no IconButton) when onEditCategory is omitted
 * 4. Inherited restriction shows LockIcon with correct aria-label
 * 5. Dialog title, close button, empty state
 * 6. Add category flow (root + child)
 * 7. Delete confirmation dialog
 * 8. Visibility toggle
 * 9. Edit button opens edit dialog
 * 10. Image count display
 * 11. Category indentation via depth
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageCategoriesDialog from '../../src/components/ManageCategoriesDialog'
import type { Program } from '../../src/types'
import { makeCategory, makeImage } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const programs: Program[] = [
  { id: 10, name: 'Pathology', oidc_group: null, created_at: '', updated_at: '' },
]

function renderDialog(overrides: Partial<Parameters<typeof ManageCategoriesDialog>[0]> = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onAddCategory = overrides.onAddCategory ?? vi.fn().mockResolvedValue(99)
  const onDeleteCategory = overrides.onDeleteCategory ?? vi.fn().mockResolvedValue(undefined)
  const onEditCategory = overrides.onEditCategory ?? vi.fn().mockResolvedValue(undefined)
  const onToggleVisibility = overrides.onToggleVisibility ?? undefined
  const onReorderCategories = overrides.onReorderCategories ?? undefined
  return {
    onClose,
    onAddCategory,
    onDeleteCategory,
    onEditCategory,
    ...render(
      <ManageCategoriesDialog
        open={overrides.open ?? true}
        onClose={onClose}
        categories={overrides.categories ?? []}
        uncategorizedImages={overrides.uncategorizedImages}
        onAddCategory={onAddCategory}
        onDeleteCategory={onDeleteCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleVisibility}
        onReorderCategories={onReorderCategories}
        programs={overrides.programs ?? programs}
        groups={overrides.groups ?? []}
      />,
    ),
  }
}

// ---------------------------------------------------------------------------
// Tests — Dialog basics
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — basics', () => {
  it('renders dialog title and close button', () => {
    renderDialog()
    expect(screen.getByText('Manage Categories')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows "No categories yet." when categories is empty', () => {
    renderDialog({ categories: [] })
    expect(screen.getByText('No categories yet.')).toBeInTheDocument()
  })

  it('shows Root level label', () => {
    renderDialog()
    expect(screen.getByText('Root level')).toBeInTheDocument()
  })

  it('renders category labels with image counts', () => {
    const categories = [
      makeCategory({
        id: 1,
        label: 'Histology',
        images: [makeImage({ id: 1 }), makeImage({ id: 2 })],
      }),
    ]
    renderDialog({ categories })
    expect(screen.getByText('Histology')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('renders child prefix for nested categories', () => {
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        children: [makeCategory({ id: 2, label: 'Child', parentId: 1 })],
      }),
    ]
    renderDialog({ categories })
    expect(screen.getByText('Parent')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    // Child has └ prefix
    expect(screen.getByText('└')).toBeInTheDocument()
  })

  it('does not render dialog content when open is false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Manage Categories')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — Add category
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — add category', () => {
  it('opens AddCategoryDialog when root "+" button is clicked', async () => {
    const user = userEvent.setup()
    renderDialog()
    // The root-level add button has the tooltip "Add root category"
    const addButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="AddIcon"]'))
    // First add button is root level
    await user.click(addButtons[0])
    // AddCategoryDialog should open with a label input
    expect(screen.getByLabelText('Category name')).toBeInTheDocument()
  })

  it('opens AddCategoryDialog for child when "+" on a category is clicked', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Organs' })]
    renderDialog({ categories })

    // The "Add child category" button is on the category row
    const addButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="AddIcon"]'))
    // Second add button is child of first category
    await user.click(addButtons[addButtons.length - 1])
    expect(screen.getByLabelText('Category name')).toBeInTheDocument()
  })

  it('calls onAddCategory when a new category is added', async () => {
    const user = userEvent.setup()
    const { onAddCategory } = renderDialog()

    // Open add dialog via root "+"
    const addButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="AddIcon"]'))
    await user.click(addButtons[0])

    // Type a name and submit
    await user.type(screen.getByLabelText('Category name'), 'New Category')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(onAddCategory).toHaveBeenCalledTimes(1)
    })
    expect(onAddCategory).toHaveBeenCalledWith('New Category', null, [], [])
  })
})

// ---------------------------------------------------------------------------
// Tests — Delete category
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — delete category', () => {
  it('opens confirmation dialog when delete button is clicked', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Tissues' })]
    renderDialog({ categories })

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="DeleteIcon"]'))
    await user.click(deleteButtons[0])

    expect(screen.getByText('Delete Category')).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument()
    // "Tissues" appears in both the list and the confirm dialog (<strong>)
    expect(screen.getAllByText('Tissues').length).toBeGreaterThanOrEqual(2)
  })

  it('calls onDeleteCategory when confirmed', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 42, label: 'Tissues' })]
    const { onDeleteCategory } = renderDialog({ categories })

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="DeleteIcon"]'))
    await user.click(deleteButtons[0])

    // Confirm
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(onDeleteCategory).toHaveBeenCalledWith(42)
    })
  })

  it('closes confirmation dialog when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Tissues' })]
    renderDialog({ categories })

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="DeleteIcon"]'))
    await user.click(deleteButtons[0])

    expect(screen.getByText('Delete Category')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('Delete Category')).not.toBeInTheDocument()
    })
  })

  it('shows sub-category warning when deleting a parent', async () => {
    const user = userEvent.setup()
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        children: [
          makeCategory({ id: 2, label: 'Child A', parentId: 1 }),
          makeCategory({ id: 3, label: 'Child B', parentId: 1 }),
        ],
      }),
    ]
    renderDialog({ categories })

    // Delete the parent
    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="DeleteIcon"]'))
    await user.click(deleteButtons[0])

    expect(screen.getByText(/sub-categor/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — Edit category
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — edit category', () => {
  it('opens edit dialog when edit button is clicked', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Anatomy' })]
    renderDialog({ categories })

    const editButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="EditIcon"]'))
    await user.click(editButtons[0])

    expect(screen.getByDisplayValue('Anatomy')).toBeInTheDocument()
  })

  it('does not render edit buttons when onEditCategory is omitted', () => {
    const categories = [makeCategory({ id: 1, label: 'Anatomy' })]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        programs={programs}
      />,
    )
    const editButtons = screen
      .queryAllByRole('button')
      .filter((btn) => btn.querySelector('svg[data-testid="EditIcon"]'))
    expect(editButtons).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests — Visibility toggle
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — visibility toggle', () => {
  it('renders visibility buttons when onToggleVisibility is provided', () => {
    const categories = [makeCategory({ id: 1, label: 'Active Cat' })]
    renderDialog({ categories, onToggleVisibility: vi.fn() })
    expect(screen.getByLabelText('Visibility: Hide category')).toBeInTheDocument()
  })

  it('calls onToggleVisibility when visibility button is clicked', async () => {
    const user = userEvent.setup()
    const onToggleVisibility = vi.fn().mockResolvedValue(undefined)
    const categories = [makeCategory({ id: 7, label: 'Cat' })]
    renderDialog({ categories, onToggleVisibility })

    await user.click(screen.getByLabelText('Visibility: Hide category'))
    expect(onToggleVisibility).toHaveBeenCalledWith(7)
  })

  it('renders "Show category" for hidden categories', () => {
    const categories = [makeCategory({ id: 1, label: 'Hidden', status: 'hidden' })]
    renderDialog({ categories, onToggleVisibility: vi.fn() })
    expect(screen.getByLabelText('Visibility: Show category')).toBeInTheDocument()
  })

  it('dims inherited-hidden child rows and shows the inherited hidden icon', () => {
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        status: 'hidden',
        children: [makeCategory({ id: 2, label: 'Child', parentId: 1 })],
      }),
    ]
    renderDialog({ categories, onToggleVisibility: vi.fn() })

    const childRow = screen.getByText('Child').closest('li')
    const inheritedButton = screen.getByLabelText('Visibility: Hidden by parent category')

    expect(childRow).toHaveStyle({ opacity: '0.5' })
    expect(inheritedButton.querySelector('[data-testid="VisibilityOffIcon"]')).toBeInTheDocument()
  })

  it('does not render visibility buttons when onToggleVisibility is omitted', () => {
    const categories = [makeCategory({ id: 1, label: 'Cat' })]
    renderDialog({ categories })
    expect(screen.queryByLabelText('Visibility: Hide category')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — Drag handle
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — drag handle', () => {
  it('renders drag handles when onReorderCategories is provided', () => {
    const categories = [makeCategory({ id: 1, label: 'Cat' })]
    renderDialog({ categories, onReorderCategories: vi.fn() })
    expect(document.querySelector('svg[data-testid="DragIndicatorIcon"]')).toBeInTheDocument()
  })

  it('does not render drag handles when onReorderCategories is omitted', () => {
    const categories = [makeCategory({ id: 1, label: 'Cat' })]
    renderDialog({ categories })
    expect(document.querySelector('svg[data-testid="DragIndicatorIcon"]')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests — LockIcon
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — LockIcon', () => {
  it('renders LockIcon for a category with programIds', () => {
    const categories = [makeCategory({ id: 1, label: 'Restricted', programIds: [10] })]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onEditCategory={vi.fn()}
        programs={programs}
      />,
    )
    expect(screen.getByText('Restricted')).toBeInTheDocument()
    expect(screen.getByLabelText('Restricted to specific programs')).toBeInTheDocument()
  })

  it('clicking LockIcon opens edit dialog when onEditCategory is provided', async () => {
    const user = userEvent.setup()
    const categories = [makeCategory({ id: 1, label: 'Restricted', programIds: [10] })]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onEditCategory={vi.fn()}
        programs={programs}
      />,
    )
    const lockButton = screen.getByLabelText('Restricted to specific programs')
    expect(lockButton.tagName).toBe('BUTTON')
    await user.click(lockButton)
    // EditCategoryDialog should now be open with the category label pre-filled
    expect(screen.getByDisplayValue('Restricted')).toBeInTheDocument()
  })

  it('LockIcon is not wrapped in a button when onEditCategory is omitted', () => {
    const categories = [makeCategory({ id: 1, label: 'Restricted', programIds: [10] })]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        programs={programs}
      />,
    )
    const lockSpan = screen.getByLabelText('Restricted to specific programs')
    expect(lockSpan.tagName).toBe('SPAN')
    expect(lockSpan.closest('button')).toBeNull()
    expect(lockSpan).toHaveAttribute('role', 'img')
  })

  it('renders inherited restriction LockIcon for child categories', () => {
    const parent = makeCategory({
      id: 1,
      label: 'Parent',
      programIds: [10],
      children: [makeCategory({ id: 2, label: 'Child', parentId: 1, programIds: [] })],
    })
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={[parent]}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onEditCategory={vi.fn()}
        programs={programs}
      />,
    )
    expect(screen.getByLabelText('Restricted to specific programs')).toBeInTheDocument()
    expect(screen.getByLabelText('Program restriction inherited from parent')).toBeInTheDocument()
  })

  it('renders LockIcon for a category with groupIds', () => {
    const categories = [makeCategory({ id: 1, label: 'Group Restricted', groupIds: [20] })]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onEditCategory={vi.fn()}
        programs={programs}
      />,
    )
    expect(screen.getByText('Group Restricted')).toBeInTheDocument()
    expect(screen.getByLabelText('Restricted to specific groups')).toBeInTheDocument()
  })

  it('renders inherited group restriction LockIcon for child categories', () => {
    const parent = makeCategory({
      id: 1,
      label: 'Parent',
      groupIds: [20],
      children: [makeCategory({ id: 2, label: 'Child', parentId: 1, groupIds: [] })],
    })
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={[parent]}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onEditCategory={vi.fn()}
        programs={programs}
      />,
    )
    expect(screen.getByLabelText('Restricted to specific groups')).toBeInTheDocument()
    expect(screen.getByLabelText('Group restriction inherited from parent')).toBeInTheDocument()
  })
})
