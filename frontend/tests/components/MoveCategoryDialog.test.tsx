import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveCategoryDialog from '../../src/components/MoveCategoryDialog'
import type { Category } from '../../src/types'

// Mock CategoryPickerSelect since it is a complex component tested separately
vi.mock('../../src/components/CategoryPickerSelect', () => ({
  default: ({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) => (
    <select
      data-testid="category-picker"
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Root</option>
      <option value="10">Category 10</option>
    </select>
  ),
}))

const categories: Category[] = [
  { id: 1, label: 'Architecture', parentId: null, children: [], images: [] },
  { id: 10, label: 'Italian', parentId: 1, children: [], images: [] },
]

const category: Category = {
  id: 1,
  label: 'Architecture',
  parentId: null,
  children: [],
  images: [],
}

describe('MoveCategoryDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and category name', () => {
    render(
      <MoveCategoryDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        category={category}
        categories={categories}
      />,
    )
    expect(screen.getByText('Move Category')).toBeInTheDocument()
    expect(screen.getByText(/Architecture/)).toBeInTheDocument()
  })

  it('calls onMove with selected parent when Move is clicked', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    render(
      <MoveCategoryDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        category={category}
        categories={categories}
      />,
    )

    const picker = screen.getByTestId('category-picker')
    await user.selectOptions(picker, '10')
    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMove).toHaveBeenCalledWith(1, 10)
  })

  it('cancel calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MoveCategoryDialog
        open
        onClose={onClose}
        onMove={vi.fn()}
        category={category}
        categories={categories}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing for category name when category is null', () => {
    render(
      <MoveCategoryDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        category={null}
        categories={categories}
      />,
    )
    expect(screen.getByText('Move Category')).toBeInTheDocument()
    // No "Move ..." text
    expect(screen.queryByText(/Move \u201c/)).not.toBeInTheDocument()
  })
})
