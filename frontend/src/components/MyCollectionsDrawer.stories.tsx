import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { CollectionSummary } from '../types'
import MyCollectionsDrawer from './MyCollectionsDrawer'

const FIXED_AT = '2026-09-01T09:00:00Z'

const collectionExamples: [CollectionSummary, CollectionSummary] = [
  {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal and lateral views side by side.',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: null,
    coverImageId: null,
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
  },
  {
    id: 2,
    name: 'Fracture healing timeline',
    description: 'Follow healing across several visits.',
    type: 'sequence',
    visibility: 'public',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 6,
    coverThumb: null,
    coverImageId: null,
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
  },
]

const eightCollections: CollectionSummary[] = Array.from({ length: 8 }, (_, index) => {
  const collection = collectionExamples[index % collectionExamples.length]
  return {
    ...collection,
    id: index + 1,
    name: `${collection.name} ${index + 1}`,
  }
})

const meta = {
  title: 'Components/MyCollectionsDrawer',
  component: MyCollectionsDrawer,
  args: {
    collections: collectionExamples,
    categories: [],
    programs: [],
    groups: [],
    open: false,
    pinned: false,
    onOpenChange: fn(),
    onPinnedChange: fn(),
    onOpen: fn(),
    onSeeAll: fn(),
    onNewCollection: fn(),
    bottomOffset: 0,
  },
  decorators: [
    (Story) => (
      <Box sx={{ minHeight: 480, p: 2 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof MyCollectionsDrawer>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  name: 'Closed (Button)',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'My collections' }))
    await expect(args.onOpenChange).toHaveBeenCalledWith(true)
  },
}

export const OpenUnpinned: Story = {
  args: {
    open: true,
  },
}

export const OpenPinned: Story = {
  args: {
    open: true,
    pinned: true,
  },
}

export const NewCollectionDisabledAtCap: Story = {
  args: {
    open: true,
    newCollectionDisabled: true,
  },
}

export const EightCardsOverflowing: Story = {
  args: {
    collections: eightCollections,
    open: true,
    pinned: true,
  },
}
