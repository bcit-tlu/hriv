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

import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageCategoriesDialog from '../../src/components/ManageCategoriesDialog'
import type { Program } from '../../src/types'
import { resetCategoryTreeExpansionPreferencesForTests } from '../../src/useCategoryTreeExpansionPreferences'
import { makeCategory, makeImage } from '../helpers/fixtures'

beforeEach(() => {
  localStorage.clear()
  resetCategoryTreeExpansionPreferencesForTests()
})

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
  const onCategoryNavigate = overrides.onCategoryNavigate ?? undefined
  return {
    onClose,
    onAddCategory,
    onDeleteCategory,
    onEditCategory,
    onCategoryNavigate,
    ...render(
      <ManageCategoriesDialog
        open={overrides.open ?? true}
        onClose={onClose}
        categories={overrides.categories ?? []}
        uncategorizedImages={overrides.uncategorizedImages}
        onCategoryNavigate={onCategoryNavigate}
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

  it('renders expand/collapse controls for categories with children', () => {
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        children: [makeCategory({ id: 2, label: 'Child', parentId: 1 })],
      }),
    ]
    renderDialog({ categories })
    expect(screen.getByRole('button', { name: 'Collapse Parent' })).toBeInTheDocument()
  })

  it('collapses child categories when the collapse control is clicked', async () => {
    const user = userEvent.setup()
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        children: [makeCategory({ id: 2, label: 'Child', parentId: 1 })],
      }),
    ]
    renderDialog({ categories })

    await user.click(screen.getByRole('button', { name: 'Collapse Parent' }))

    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Parent' })).toBeInTheDocument()
  })

  it('calls onCategoryNavigate when a category link is clicked', async () => {
    const user = userEvent.setup()
    const onCategoryNavigate = vi.fn()
    const categories = [makeCategory({ id: 1, label: 'Histology' })]
    renderDialog({ categories, onCategoryNavigate })

    await user.click(screen.getByRole('button', { name: 'Histology' }))

    expect(onCategoryNavigate).toHaveBeenCalledWith(1)
  })

  it('auto-expands categories that become parents after rerender in StrictMode', () => {
    const leaf = makeCategory({ id: 1, label: 'Leaf' })
    const child = makeCategory({ id: 2, label: 'Child', parentId: 1 })
    const onAddCategory = vi.fn().mockResolvedValue(99)
    const onDeleteCategory = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(
      <StrictMode>
        <ManageCategoriesDialog
          open
          onClose={vi.fn()}
          categories={[leaf]}
          onAddCategory={onAddCategory}
          onDeleteCategory={onDeleteCategory}
          programs={programs}
        />
      </StrictMode>,
    )

    rerender(
      <StrictMode>
        <ManageCategoriesDialog
          open
          onClose={vi.fn()}
          categories={[makeCategory({ ...leaf, children: [child] })]}
          onAddCategory={onAddCategory}
          onDeleteCategory={onDeleteCategory}
          programs={programs}
        />
      </StrictMode>,
    )

    expect(screen.getByRole('button', { name: 'Collapse Leaf' })).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
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

// ---------------------------------------------------------------------------
// Tests — Edit save flow
// ---------------------------------------------------------------------------

describe('ManageCategoriesDialog — edit save', () => {
  it('saves an edited nested category with inherited restrictions and hidden ancestor', async () => {
    const user = userEvent.setup()
    const onEditCategory = vi.fn().mockResolvedValue(undefined)
    const categories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        status: 'hidden',
        programIds: [10],
        groupIds: [20],
        children: [makeCategory({ id: 2, label: 'Child', parentId: 1 })],
      }),
    ]
    renderDialog({ categories, onEditCategory })

    const childRow = screen.getByText('Child').closest('li') as HTMLElement
    await user.click(
      childRow.querySelector('svg[data-testid="EditIcon"]')?.closest('button') as HTMLElement,
    )

    const nameField = screen.getByDisplayValue('Child')
    await user.clear(nameField)
    await user.type(nameField, 'Renamed Child')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onEditCategory).toHaveBeenCalledTimes(1))
    expect(onEditCategory.mock.calls[0][0]).toBe(2)
    expect(onEditCategory.mock.calls[0][1]).toBe('Renamed Child')
  })
})

// ---------------------------------------------------------------------------
// Tests — Drag-and-drop reorder
// ---------------------------------------------------------------------------

/** Give the list and its rows deterministic geometry (jsdom rects are all 0). */
function mockListGeometry() {
  const list = document.querySelector('ul') as HTMLElement
  const listRect = { top: 0, bottom: 400, left: 0, right: 400, width: 400, height: 400, x: 0, y: 0 }
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
    ...listRect,
    toJSON: () => listRect,
  } as DOMRect)
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-category-id]'))
  rows.forEach((el, i) => {
    const rect = {
      top: i * 40,
      bottom: i * 40 + 40,
      left: 0,
      right: 400,
      width: 400,
      height: 40,
      x: 0,
      y: i * 40,
    }
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      toJSON: () => rect,
    } as DOMRect)
  })
  return { list, rows }
}

function makeDataTransfer() {
  return { effectAllowed: '', dropEffect: '', setData: vi.fn() }
}

/** jsdom lacks DragEvent, so drag events lose clientX/clientY; use a MouseEvent. */
function fireDragOverAt(target: HTMLElement, clientX: number, clientY: number) {
  const event = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY })
  Object.defineProperty(event, 'dataTransfer', { value: makeDataTransfer() })
  fireEvent(target, event)
}

describe('ManageCategoriesDialog — drag-and-drop reorder', () => {
  const rootCategories = () => [
    makeCategory({ id: 1, label: 'Alpha' }),
    makeCategory({ id: 2, label: 'Beta' }),
    makeCategory({ id: 3, label: 'Gamma' }),
  ]

  function dragRow(label: string) {
    const row = screen.getByText(label).closest('li') as HTMLElement
    fireEvent.dragStart(row, { dataTransfer: makeDataTransfer() })
    return row
  }

  it('reorders a root category to the end via drag-and-drop', async () => {
    const onReorderCategories = vi.fn().mockResolvedValue(undefined)
    const onReorderComplete = vi.fn()
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={rootCategories()}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        onReorderComplete={onReorderComplete}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    dragRow('Beta')
    // Drop below Gamma (row midpoints: 20=Alpha, 60=Beta, 100=Gamma)
    fireDragOverAt(list, 5, 300)
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })

    await waitFor(() => expect(onReorderCategories).toHaveBeenCalledTimes(1))
    const items = onReorderCategories.mock.calls[0][0] as Array<{
      id: number
      parent_id: number | null
      sort_order: number
    }>
    const beta = items.find((i) => i.id === 2)
    expect(beta).toMatchObject({ parent_id: null, sort_order: 2 })
    await waitFor(() => expect(onReorderComplete).toHaveBeenCalledTimes(1))
  })

  it('nests a category under a new parent when dropped indented', async () => {
    const onReorderCategories = vi.fn().mockResolvedValue(undefined)
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={rootCategories()}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    dragRow('Gamma')
    // Drop below Beta, indented one level (24px per depth step)
    fireDragOverAt(list, 30, 300)
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })

    await waitFor(() => expect(onReorderCategories).toHaveBeenCalledTimes(1))
    const items = onReorderCategories.mock.calls[0][0] as Array<{
      id: number
      parent_id: number | null
    }>
    expect(items.find((i) => i.id === 3)).toMatchObject({ parent_id: 2 })
  })

  it('refreshes via onReorderComplete and skips image reorder when category reorder fails', async () => {
    const onReorderCategories = vi.fn().mockRejectedValue(new Error('conflict'))
    const onReorderImages = vi.fn()
    const onReorderComplete = vi.fn()
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={rootCategories()}
        uncategorizedImages={[makeImage({ id: 100, sortOrder: 0 })]}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        onReorderImages={onReorderImages}
        onReorderComplete={onReorderComplete}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    dragRow('Beta')
    fireDragOverAt(list, 5, 300)
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })

    await waitFor(() => expect(onReorderComplete).toHaveBeenCalledTimes(1))
    expect(onReorderImages).not.toHaveBeenCalled()
  })

  it('reorders interleaved images alongside categories on a successful drop', async () => {
    const onReorderCategories = vi.fn().mockResolvedValue(undefined)
    const onReorderImages = vi.fn().mockResolvedValue(undefined)
    const onReorderComplete = vi.fn()
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={rootCategories()}
        uncategorizedImages={[makeImage({ id: 100, sortOrder: 0 })]}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        onReorderImages={onReorderImages}
        onReorderComplete={onReorderComplete}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    dragRow('Beta')
    fireDragOverAt(list, 5, 300)
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })

    await waitFor(() => expect(onReorderImages).toHaveBeenCalledTimes(1))
    expect(onReorderImages.mock.calls[0][0]).toEqual([{ id: 100, sort_order: expect.any(Number) }])
    await waitFor(() => expect(onReorderComplete).toHaveBeenCalledTimes(1))
  })

  it('does nothing when dropped without a computed drop target', async () => {
    const onReorderCategories = vi.fn().mockResolvedValue(undefined)
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={rootCategories()}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    const row = dragRow('Beta')
    // Drop without a preceding dragOver: no drop target computed
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })
    fireEvent.dragEnd(row, { dataTransfer: makeDataTransfer() })

    expect(onReorderCategories).not.toHaveBeenCalled()
  })

  it('excludes the dragged subtree when dropping a parent after its sibling', async () => {
    const onReorderCategories = vi.fn().mockResolvedValue(undefined)
    const categories = [
      makeCategory({
        id: 1,
        label: 'Alpha',
        children: [makeCategory({ id: 4, label: 'AlphaChild', parentId: 1 })],
      }),
      makeCategory({ id: 2, label: 'Beta' }),
    ]
    render(
      <ManageCategoriesDialog
        open
        onClose={vi.fn()}
        categories={categories}
        onAddCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategories={onReorderCategories}
        programs={programs}
      />,
    )
    const { list } = mockListGeometry()

    dragRow('Alpha')
    fireDragOverAt(list, 5, 300)
    fireEvent.drop(list, { dataTransfer: makeDataTransfer() })

    await waitFor(() => expect(onReorderCategories).toHaveBeenCalledTimes(1))
    const items = onReorderCategories.mock.calls[0][0] as Array<{
      id: number
      parent_id: number | null
      sort_order: number
    }>
    // Alpha moved after Beta at root; AlphaChild stays under Alpha
    expect(items.find((i) => i.id === 1)).toMatchObject({ parent_id: null, sort_order: 1 })
    expect(items.find((i) => i.id === 2)).toMatchObject({ parent_id: null, sort_order: 0 })
    expect(items.find((i) => i.id === 4)).toMatchObject({ parent_id: 1 })
  })
})
