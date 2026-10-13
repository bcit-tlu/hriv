import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CollectionsTable from '../src/components/CollectionsTable'
import { buildCategoryPaths } from '../src/components/CategoryBreadcrumb'
import { makeCategory, makeCollectionSummary } from './helpers/fixtures'
import type { CollectionSummary, User } from '../src/types'

const USER: User = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'instructor',
  active: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
}

function row(n: Partial<CollectionSummary>): CollectionSummary {
  return makeCollectionSummary(n)
}

function renderTable(collections: CollectionSummary[], onOpen = vi.fn()) {
  const utils = render(
    <CollectionsTable
      collections={collections}
      categoryPaths={buildCategoryPaths([
        makeCategory({
          id: 1,
          label: 'Italian',
          children: [makeCategory({ id: 2, label: 'Gothic', parentId: 1 })],
        }),
      ])}
      currentUser={USER}
      onOpenCollection={onOpen}
    />,
  )
  return { ...utils, onOpen }
}

describe('CollectionsTable', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders name/type/category/owner/updated columns', () => {
    renderTable([
      row({ id: 1, name: 'Skull comparison', categoryId: 2, updatedAt: '2026-01-02T00:00:00Z' }),
      row({ id: 2, name: 'Pelvis set', categoryId: null }),
    ])
    expect(screen.getByText('Skull comparison')).toBeInTheDocument()
    expect(screen.getByText('Pelvis set')).toBeInTheDocument()
    // Category breadcrumb without the root, 'Unfiled' when categoryId is null.
    expect(screen.getByText('Italian › Gothic')).toBeInTheDocument()
    expect(screen.getByText('Unfiled')).toBeInTheDocument()
  })

  it('opens the collection from the name link and from row click', () => {
    const onOpen = vi.fn()
    renderTable([row({ id: 5, name: 'Skull comparison' })], onOpen)
    fireEvent.click(screen.getByRole('button', { name: 'Skull comparison' }))
    expect(onOpen).toHaveBeenCalledWith(5)
    onOpen.mockClear()
    fireEvent.click(screen.getByTestId('collections-table-row-5'))
    expect(onOpen).toHaveBeenCalledWith(5)
  })

  it('shows the "You" chip when the current user owns the collection', () => {
    renderTable([
      row({ id: 1, name: 'Mine', owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }] }),
      row({ id: 2, name: 'Theirs', owners: [{ kind: 'user', userId: 9, name: 'Grace' }] }),
    ])
    const mine = screen.getByTestId('collections-table-row-1')
    const theirs = screen.getByTestId('collections-table-row-2')
    expect(within(mine).getByTestId('collections-table-you-chip')).toBeInTheDocument()
    expect(within(theirs).queryByTestId('collections-table-you-chip')).not.toBeInTheDocument()
  })

  it('sorts by Updated descending by default and toggles on header click', () => {
    renderTable([
      row({ id: 1, name: 'Old', updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 2, name: 'New', updatedAt: '2026-01-10T00:00:00Z' }),
      row({ id: 3, name: 'Mid', updatedAt: '2026-01-05T00:00:00Z' }),
    ])
    const names = () => screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)
    expect(names()).toEqual([
      'collections-table-row-2',
      'collections-table-row-3',
      'collections-table-row-1',
    ])

    // Name header click sorts ascending.
    fireEvent.click(screen.getByText('Name'))
    expect(names()).toEqual([
      'collections-table-row-3',
      'collections-table-row-2',
      'collections-table-row-1',
    ])
    // Second click flips to descending.
    fireEvent.click(screen.getByText('Name'))
    expect(names()).toEqual([
      'collections-table-row-1',
      'collections-table-row-2',
      'collections-table-row-3',
    ])
  })

  it('paginates with the rows-per-page preference', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 7 }))
    localStorage.setItem('hrivpref:rows-per-page:collections:user:7', '5')
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i + 1, name: `C${i + 1}` }))
    renderTable(rows)
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(2)
  })

  it('clamps the page when filters shrink the list (#1636 review)', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 7 }))
    localStorage.setItem('hrivpref:rows-per-page:collections:user:7', '5')
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row({ id: i + 1, name: `C${i + 1}` }))
    const ui = (collections: CollectionSummary[]) => (
      <CollectionsTable
        collections={collections}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
      />
    )
    const { rerender } = render(ui(rows(7)))
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(2)

    // The shared filter shrinks the list while on page 2 — the stale page
    // must not leave the table empty.
    rerender(ui(rows(3)))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(3)
  })
})
