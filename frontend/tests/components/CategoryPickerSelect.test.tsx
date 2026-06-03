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
