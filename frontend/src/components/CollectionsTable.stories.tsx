import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import CollectionsTable, { COLLECTIONS_TABLE_COLUMNS } from './CollectionsTable'
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
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
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
          'The unified Collections page Table view (#1629): a dense, sortable, paged table — cover, name link, type chip, category breadcrumb, image count, owner (with a "You" chip), and relative Updated. Row click opens the collection; there are no bulk or edit controls.',
      },
    },
  },
  args: {
    collections: [],
    categoryPaths: buildCategoryPaths(categories),
    currentUser: viewer,
    onOpenCollection: fn(),
  },
} satisfies Meta<typeof CollectionsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    collections: [
      makeRow({ id: 1, name: 'Skull comparison', type: 'synchronized', categoryId: 2 }),
      makeRow({
        id: 2,
        name: 'Pelvis landmarks',
        type: 'sequence',
        categoryId: 1,
        imageCount: 6,
        owners: [{ kind: 'program', programId: 3, name: 'Radiography' }],
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
    await expect(canvas.getByText('Italian › Gothic')).toBeInTheDocument()
    await expect(canvas.getByTestId('collections-table-you-chip')).toBeInTheDocument()
  },
}

export const AllColumns: Story = {
  name: 'All Columns',
  args: {
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

export const Empty: Story = {
  args: { collections: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-table')).toBeInTheDocument()
    await expect(canvas.queryAllByTestId(/collections-table-row-/)).toHaveLength(0)
  },
}
