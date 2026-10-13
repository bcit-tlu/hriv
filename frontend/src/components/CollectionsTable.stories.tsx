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
          'The Collections page Table view (#1629) — the single collections table since Manage → Collections merged into it: sortable, paged rows with cover, name, type chip, category breadcrumb links, image count, owner (with a "You" chip), relative Updated, and an opt-in Visibility switch. Hidden and category-hidden rows dim; row click opens the collection, Edit / Manage owners sit in the row menu, and curators get a bulk-edit selection column.',
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
    await expect(canvas.getByRole('button', { name: 'Gothic' })).toBeInTheDocument()
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

export const Empty: Story = {
  args: { collections: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-table')).toBeInTheDocument()
    await expect(canvas.queryAllByTestId(/collections-table-row-/)).toHaveLength(0)
  },
}
