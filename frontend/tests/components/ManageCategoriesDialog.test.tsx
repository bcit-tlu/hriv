/**
 * Unit tests for ManageCategoriesDialog LockIcon behavior.
 *
 * Covers:
 * 1. LockIcon renders for restricted categories
 * 2. LockIcon click opens edit dialog when onEditCategory is provided
 * 3. LockIcon is non-interactive (no IconButton) when onEditCategory is omitted
 * 4. Inherited restriction shows LockIcon with correct aria-label
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageCategoriesDialog from '../../src/components/ManageCategoriesDialog'
import type { Category, Program } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    label: 'Test Category',
    parentId: null,
    children: [],
    images: [],
    programIds: [],
    status: null,
    cardImageId: null,
    ...overrides,
  }
}

const programs: Program[] = [
  { id: 10, name: 'Pathology', oidc_group: null, created_at: '', updated_at: '' },
]

// ---------------------------------------------------------------------------
// Tests
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
      children: [
        makeCategory({ id: 2, label: 'Child', parentId: 1, programIds: [] }),
      ],
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
    expect(screen.getByLabelText('Restricted (inherited from parent)')).toBeInTheDocument()
  })
})
