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
import { makeCategory } from '../helpers/fixtures'

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
    expect(screen.getByLabelText('Restricted (inherited from parent)')).toBeInTheDocument()
  })
})
