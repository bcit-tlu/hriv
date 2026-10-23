import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import CollectionsTable, { COLLECTIONS_TABLE_COLUMNS } from './CollectionsTable'
import {
  collectionSortDefaultDirection,
  type CollectionSort,
  type CollectionSortKey,
} from '../useCollectionsData'
import { buildCategoryPaths } from './CategoryBreadcrumb'
import type { Category, CollectionSummary, User } from '../types'

const FIXED_AT = '2026-09-01T09:00:00Z'

const categories: Category[] = [
  {
    id: 1,
    label: 'Italian',
    parentId: null,
    children: [
      {
        id: 2,
        label: 'Gothic',
        parentId: 1,
        children: [],
        images: [],
        collections: [],
        programIds: [],
        groupIds: [],
        status: null,
        sortOrder: 0,
        version: 1,
        cardImageId: null,
      },
    ],
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    cardImageId: null,
  },
]

const viewer: User = {
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

function makeRow(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal and lateral views side by side.',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace', role: 'instructor' }],
    studentCurated: false,
    imageCount: 2,
    coverThumb: '/hriv-splash2.jpg',
    coverImageId: null,
    coverBlank: false,
    categoryId: 2,
    sortOrder: 0,
    programIds: [],
    groupIds: [],
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: {
      canEdit: true,
      canDelete: true,
      canChangeScope: true,
      canTransfer: false,
      canHide: false,
    },
    ...overrides,
  }
}

const meta = {
  title: 'Components/CollectionsTable',
  component: CollectionsTable,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Collections page Table view (#1629) — the single collections table since Manage → Collections merged into it: server-sorted, server-paged rows (#1631 — sorting/paging state is controlled by the page\'s data hook) with cover, name, type chip, scope pill (the student-curated badge trails it on student-curated rows), category breadcrumb links, image count, owner (with a "You" chip), relative Updated, and an opt-in Visibility switch. Hidden and category-hidden rows dim; row click opens the collection, Edit / Manage owners sit in the row menu, and curators get a bulk-edit selection column.',
      },
    },
  },
  args: {
    collections: [],
    categoryPaths: buildCategoryPaths(categories),
    currentUser: viewer,
    onOpenCollection: fn(),
    sortKey: 'updated',
    sortDir: 'desc',
    onSortChange: fn(),
    page: 0,
    rowsPerPage: 25,
    total: 0,
    onPageChange: fn(),
    onRowsPerPageChange: fn(),
  },
} satisfies Meta<typeof CollectionsTable>

export default meta
type Story = StoryObj<typeof meta>

/** Controlled sort/page state lives in the page's hook — this wrapper
 *  plays that role so header clicks and paging still respond in the story. */
function StatefulTable(args: React.ComponentProps<typeof CollectionsTable>) {
  const [sort, setSort] = useState<CollectionSort>({ key: 'updated', direction: 'desc' })
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const sorted = [...(args.collections ?? [])].sort((a, b) => {
    const va = sort.key === 'name' ? a.name : a.updatedAt
    const vb = sort.key === 'name' ? b.name : b.updatedAt
    const cmp = String(va).localeCompare(String(vb))
    return (cmp !== 0 ? cmp : a.id - b.id) * (sort.direction === 'asc' ? 1 : -1)
  })
  return (
    <CollectionsTable
      {...args}
      collections={sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)}
      sortKey={sort.key}
      sortDir={sort.direction}
      onSortChange={(key: CollectionSortKey, dir: 'asc' | 'desc') => {
        setSort((s) => ({
          key,
          direction: s.key === key ? dir : collectionSortDefaultDirection(key),
        }))
        setPage(0)
      }}
      page={page}
      rowsPerPage={rowsPerPage}
      total={sorted.length}
      onPageChange={setPage}
      onRowsPerPageChange={(n) => {
        setRowsPerPage(n)
        setPage(0)
      }}
    />
  )
}

export const Basic: Story = {
  args: {
    total: 3,
    collections: [
      makeRow({ id: 1, name: 'Skull comparison', type: 'synchronized', categoryId: 2 }),
      makeRow({
        id: 2,
        name: 'Pelvis landmarks',
        type: 'sequence',
        categoryId: 1,
        imageCount: 6,
        // Student co-owner beside the program owner → the badge trails
        // the Scope cell.
        studentCurated: true,
        owners: [
          { kind: 'program', programId: 3, name: 'Radiography' },
          { kind: 'user', userId: 9, name: 'Sam Student', role: 'student' },
        ],
        updatedAt: '2026-08-20T09:00:00Z',
      }),
      makeRow({
        id: 3,
        name: 'Unfiled pathology',
        type: 'sequence',
        categoryId: null,
        imageCount: 0,
        coverThumb: null,
        owners: [],
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-table')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Gothic' })).toBeInTheDocument()
    await expect(canvas.getByTestId('collections-table-you-chip')).toBeInTheDocument()
  },
}

export const AllColumns: Story = {
  name: 'All Columns',
  args: {
    total: 2,
    collections: [
      makeRow({
        id: 1,
        name: 'Skull comparison',
        type: 'synchronized',
        visibility: 'restricted',
        programIds: [3],
        groupIds: [4],
        categoryId: 2,
      }),
      makeRow({
        id: 2,
        name: 'Pelvis landmarks',
        type: 'sequence',
        categoryId: 1,
        imageCount: 6,
        owners: [{ kind: 'program', programId: 3, name: 'Radiography' }],
        updatedAt: '2026-08-20T09:00:00Z',
      }),
    ],
    columns: COLLECTIONS_TABLE_COLUMNS,
    programs: [
      { id: 3, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
    ],
    groups: [
      {
        id: 4,
        name: 'Cohort A',
        description: null,
        createdByUserId: null,
        memberIds: [],
        instructorIds: [],
        createdAt: FIXED_AT,
        updatedAt: FIXED_AT,
      },
    ],
  },
}

/** Curator view: hidden rows dim (own-hidden adds the eye-off marker; a
 *  hidden filing category locks the switch), plus selection and row menu. */
export const HiddenRows: Story = {
  name: 'Hidden Rows',
  args: {
    categoryPaths: buildCategoryPaths([
      ...categories,
      { ...categories[0], id: 9, label: 'Archive', status: 'hidden', children: [] },
    ]),
    columns: ['cover', 'name', 'type', 'category', 'owner', 'visibility', 'updated'],
    total: 3,
    selected: new Set([2]),
    onSelectedChange: fn(),
    onEdit: fn(),
    onManageOwners: fn(),
    onToggleHidden: fn(),
    collections: [
      makeRow({
        id: 1,
        name: 'Visible set',
        permissions: { ...makeRow().permissions, canHide: true },
      }),
      makeRow({
        id: 2,
        name: 'Hidden set',
        hidden: true,
        permissions: { ...makeRow().permissions, canHide: true },
      }),
      makeRow({
        id: 3,
        name: 'In hidden category',
        categoryId: 9,
        permissions: { ...makeRow().permissions, canHide: true },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Visibility: Hidden' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('switch', { name: 'Visibility for In hidden category' }),
    ).toBeDisabled()
    await expect(canvas.getByRole('checkbox', { name: 'Select Hidden set' })).toBeChecked()
  },
}

/** Interactive slice of the server-paged contract: header clicks flip the
 *  sort and the footer pages the full fixture set. */
export const SortableAndPaged: Story = {
  name: 'Sortable And Paged',
  args: {
    collections: Array.from({ length: 12 }, (_, i) =>
      makeRow({
        id: i + 1,
        name: `Collection ${String(i + 1).padStart(2, '0')}`,
        categoryId: i % 2 === 0 ? 2 : 1,
        imageCount: (i * 3) % 7,
        updatedAt: `2026-08-${String(10 + i).padStart(2, '0')}T09:00:00Z`,
      }),
    ),
  },
  render: (args) => <StatefulTable {...args} />,
}

export const Empty: Story = {
  args: { collections: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-table')).toBeInTheDocument()
    await expect(canvas.queryAllByTestId(/collections-table-row-/)).toHaveLength(0)
  },
}
