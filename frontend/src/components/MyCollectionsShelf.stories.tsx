import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import MyCollectionsShelf from './MyCollectionsShelf'
import type { CollectionSummary } from '../types'

const FIXED_AT = '2026-09-01T09:00:00Z'

const collections: CollectionSummary[] = [
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

const meta = {
  title: 'Components/MyCollectionsShelf',
  component: MyCollectionsShelf,
  args: {
    collections,
    programs: [],
    groups: [],
    onOpen: fn(),
    onSeeAll: fn(),
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 1200, p: 2 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof MyCollectionsShelf>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'See all' }))
    await expect(args.onSeeAll).toHaveBeenCalledOnce()
  },
}
