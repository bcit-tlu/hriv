import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Category, CollectionSummary, ImageItem, Program } from '../types'
import type { ApiUser } from '../api'
import SearchModal from './SearchModal'

const FIXED_AT = '2026-09-01T09:00:00Z'

const images: ImageItem[] = [
  {
    id: 10,
    name: 'Liver Section',
    thumb: '',
    tileSources: '/tiles/10.dzi',
    categoryId: 1,
    copyright: '2026 BCIT',
    note: 'Reference atlas for liver tissue',
    active: true,
    sortOrder: 0,
    version: 1,
    metadataExtra: null,
  },
  {
    id: 11,
    name: 'Kidney Cross',
    thumb: '',
    tileSources: '/tiles/11.dzi',
    categoryId: 1,
    copyright: 'Kidney Foundation 2026',
    note: 'Cross-section of kidney cortex',
    active: true,
    sortOrder: 1,
    version: 1,
    metadataExtra: null,
  },
]

const categories: Category[] = [
  {
    id: 1,
    label: 'Histology',
    parentId: null,
    children: [],
    images,
    collections: [],
    programIds: [1],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    cardImageId: null,
    metadataExtra: null,
  },
]

const programs: Program[] = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
]

const users: ApiUser[] = [
  {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'instructor',
    active: true,
    program_ids: [1],
    program_names: ['Radiography'],
    group_ids: [],
    group_names: [],
    last_access: null,
    metadata_extra: null,
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
  },
]

function makeSummary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal vs lateral',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: null,
    categoryId: null,
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

const collections: CollectionSummary[] = [
  makeSummary({ id: 5 }),
  makeSummary({
    id: 6,
    name: 'Cardiac series',
    description: 'Liver histology basics',
    type: 'sequence',
    imageCount: 6,
    owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
  }),
]

const meta = {
  title: 'Components/SearchModal',
  component: SearchModal,
  args: {
    open: true,
    onClose: fn(),
    categories,
    uncategorizedImages: [],
    programs,
    users,
    collections,
    collectionsEnabled: true,
    excludeHidden: false,
    suppressExtendedResults: false,
    onSelectCategory: fn(),
    onSelectImage: fn(),
    onSelectProgram: fn(),
    onSelectUser: fn(),
    onSelectGuide: fn(),
    onSelectCollection: fn(),
    onAddImagesToCollection: fn(),
  },
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
    // Known theme-palette contrast debt (match-highlight chips) — see #1345.
    a11y: { test: 'todo' },
  },
} satisfies Meta<typeof SearchModal>

export default meta

type Story = StoryObj<typeof meta>

/** Mixed result kinds for one query — an image plus a collection matched on its description. */
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByPlaceholderText(/Search categories, images/), 'liver')
    await expect(await body.findByText('Liver Section')).toBeVisible()
    await expect(await body.findByText('Cardiac series')).toBeVisible()
    await expect(body.getByText(/Sequence · 6 images/)).toBeVisible()
  },
}

/** Image rows gain labelled checkboxes; the footer emits ids in result order. */
export const MultiSelect: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByPlaceholderText(/Search categories, images/), 'section')
    await userEvent.click(await body.findByTestId('search-select-toggle'))
    await userEvent.click(await body.findByRole('checkbox', { name: 'Select Kidney Cross' }))
    await userEvent.click(await body.findByRole('checkbox', { name: 'Select Liver Section' }))
    await expect(body.getByText('2 images selected')).toBeVisible()
    await userEvent.click(body.getByTestId('search-add-to-collection'))
    await expect(args.onAddImagesToCollection).toHaveBeenCalledWith([10, 11])
  },
}
