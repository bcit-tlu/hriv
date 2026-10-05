import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import CollectionCard from './CollectionCard'
import type { CollectionSummary } from '../types'

const FIXED_AT = '2026-09-01T09:00:00Z'

function makeSummary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal and lateral views side by side.',
    type: 'synchronized',
    visibility: 'private',
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: '/hriv-splash2.jpg',
    categoryId: null,
    sortOrder: 0,
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: { canEdit: true, canDelete: true, canChangeScope: true, canTransfer: false },
    ...overrides,
  }
}

const meta = {
  title: 'Components/CollectionCard',
  component: CollectionCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Collections-page card showing the cover thumbnail, name, image count, owner and visibility chip. The type chip, Move and Owners actions sit in a top-right cover overlay (CategoryTile scrim convention, #1554); Edit sits in the metadata area, permission-gated. Delete is not a card action — it lives inside the edit dialog.',
      },
    },
  },
  args: {
    collection: makeSummary(),
    onOpen: fn(),
    onEdit: fn(),
  },
  // Padding keeps the card's elevation shadow inside Chromatic's content-cropped snapshot.
  decorators: [
    (Story) => (
      <Box sx={{ width: 296, p: 1 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof CollectionCard>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  parameters: {
    // CardActionArea + absolutely-positioned action icons — nested-interactive debt, see #1345.
    a11y: { test: 'todo' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const area = canvas.getByTestId('collection-card-action-area')
    await userEvent.click(area)
    await expect(args.onOpen).toHaveBeenCalledWith(args.collection)
    // Snapshot the resting card, not the hover/focus highlight left behind by the click.
    await userEvent.unhover(area)
    area.blur()
  },
}

export const Sequence: Story = {
  args: {
    collection: makeSummary({
      id: 2,
      name: 'Fracture healing timeline',
      type: 'sequence',
      visibility: 'public',
      imageCount: 6,
      owners: [{ kind: 'program', programId: 3, name: 'Radiography' }],
    }),
  },
  parameters: {
    a11y: { test: 'todo' },
  },
}

export const Restricted: Story = {
  args: {
    collection: makeSummary({
      id: 3,
      name: 'Cohort 2 review set',
      visibility: 'restricted',
      imageCount: 1,
    }),
  },
  parameters: {
    // Restricted chip reuses the group-chip palette — known contrast debt, see #1345.
    a11y: { test: 'todo' },
  },
}

export const Curatorial: Story = {
  args: {
    collection: makeSummary({
      id: 7,
      name: 'Filed into Browse',
      permissions: { canEdit: true, canDelete: true, canChangeScope: true, canTransfer: true },
    }),
    onTransfer: fn(),
    onMove: fn(),
  },
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // Overlay actions stop propagation — the card does not open.
    await userEvent.click(
      canvas.getByRole('button', { name: 'Move Filed into Browse to a category' }),
    )
    await expect(args.onMove).toHaveBeenCalledWith(args.collection)
    await expect(args.onOpen).not.toHaveBeenCalled()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Manage owners of Filed into Browse' }),
    )
    await expect(args.onTransfer).toHaveBeenCalledWith(args.collection)
    await expect(args.onOpen).not.toHaveBeenCalled()
  },
}

export const ReadOnly: Story = {
  name: 'Read Only',
  args: {
    collection: makeSummary({
      id: 4,
      name: 'Shared by an instructor',
      visibility: 'public',
      permissions: { canEdit: false, canDelete: false, canChangeScope: false, canTransfer: false },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  },
}

export const NoCover: Story = {
  name: 'No Cover',
  args: {
    collection: makeSummary({
      id: 5,
      name: 'Empty collection',
      imageCount: 0,
      coverThumb: null,
      owners: [],
    }),
  },
  parameters: {
    a11y: { test: 'todo' },
  },
}

export const LongName: Story = {
  name: 'Long Name',
  args: {
    collection: makeSummary({
      id: 6,
      name: 'A very long collection name that keeps going well past the width of the card and is clamped to two lines',
    }),
  },
  parameters: {
    a11y: { test: 'todo' },
  },
}
