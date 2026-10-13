import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryBreadcrumb, { buildCategoryPaths } from '../../src/components/CategoryBreadcrumb'
import { makeCategory } from '../helpers/fixtures'

const root = makeCategory({ id: 1, label: 'Anatomy' })
const child = makeCategory({ id: 2, label: 'Skeletal', parentId: 1 })
const leaf = makeCategory({ id: 3, label: 'Bones', parentId: 2 })
const tree = [{ ...root, children: [{ ...child, children: [leaf] }] }]
const categoryPaths = buildCategoryPaths(tree)

describe('buildCategoryPaths', () => {
  it('maps each node to itself plus its ancestor chain', () => {
    const seg = categoryPaths.get(3)
    expect(seg?.category.id).toBe(3)
    expect(seg?.ancestors.map((a) => a.id)).toEqual([1, 2])
    expect(categoryPaths.get(1)?.ancestors).toEqual([])
  })
})

describe('CategoryBreadcrumb', () => {
  it('renders an em dash when the category is null', () => {
    render(<CategoryBreadcrumb categoryId={null} categoryPaths={categoryPaths} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders the bare id when the category is not in the path map', () => {
    render(<CategoryBreadcrumb categoryId={99} categoryPaths={categoryPaths} />)
    expect(screen.getByText('99')).toBeInTheDocument()
  })

  it('renders the ancestor path as colon-separated links', () => {
    render(<CategoryBreadcrumb categoryId={3} categoryPaths={categoryPaths} />)
    expect(screen.getByRole('button', { name: 'Anatomy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skeletal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bones' })).toBeInTheDocument()
    expect(screen.getAllByText(':')).toHaveLength(2)
  })

  it('navigates to the clicked segment prefix', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <CategoryBreadcrumb categoryId={3} categoryPaths={categoryPaths} onNavigate={onNavigate} />,
    )
    await user.click(screen.getByRole('button', { name: 'Skeletal' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0][0].map((c: { id: number }) => c.id)).toEqual([1, 2])
  })

  it('shows the hidden indicator when a path segment is hidden', () => {
    const hiddenTree = [
      { ...root, status: 'hidden' as const, children: [{ ...child, children: [leaf] }] },
    ]
    const hiddenPaths = buildCategoryPaths(hiddenTree)
    render(<CategoryBreadcrumb categoryId={3} categoryPaths={hiddenPaths} hiddenColor="#a00" />)
    expect(screen.getByLabelText('Category hidden from students by ancestor')).toBeInTheDocument()
  })

  it('hides the indicator without a hiddenColor even when hidden', () => {
    const hiddenTree = [
      { ...root, children: [{ ...child, status: 'hidden' as const, children: [leaf] }] },
    ]
    const hiddenPaths = buildCategoryPaths(hiddenTree)
    render(<CategoryBreadcrumb categoryId={3} categoryPaths={hiddenPaths} />)
    expect(screen.queryByLabelText(/hidden from students/)).not.toBeInTheDocument()
  })
})
