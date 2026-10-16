import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { ImageViewerInfoBarProps } from './ImageViewerInfoBar'
import ImageViewerInfoBar from './ImageViewerInfoBar'
import ImageCollectionsList from './ImageCollectionsList'
import ViewportDialog from './ViewportDialog'

const COLLECTIONS = [
  { id: 1621, name: 'Duomo archive' },
  { id: 1622, name: 'Italian architecture' },
]

/**
 * The bar sits below the viewer; its "…more" / "+ N more" affordances open a
 * ViewportDialog over the viewer. In the app the dialog lives inside the OSD
 * container — here a plain relative Box stands in for the viewport.
 */
function InfoBarExample(args: ImageViewerInfoBarProps) {
  const [dialog, setDialog] = useState<'note' | 'collections' | null>(null)
  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          position: 'relative',
          height: 220,
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        <ViewportDialog open={dialog === 'note'} title="Notes" onClose={() => setDialog(null)}>
          <Box sx={{ typography: 'body2', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {args.note}
          </Box>
        </ViewportDialog>
        <ViewportDialog
          open={dialog === 'collections'}
          title="Collections"
          onClose={() => setDialog(null)}
        >
          {/* A collection link also closes the dialog. */}
          <Box
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) setDialog(null)
            }}
          >
            <ImageCollectionsList
              collections={args.collections}
              limit={args.collections.length}
              hrefForCollection={args.hrefForCollection}
              onOpenCollection={args.onOpenCollection}
            />
          </Box>
        </ViewportDialog>
      </Box>
      <ImageViewerInfoBar
        {...args}
        noteDialogOpen={dialog === 'note'}
        collectionsDialogOpen={dialog === 'collections'}
        onShowNote={() => setDialog('note')}
        onShowCollections={() => setDialog('collections')}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/ImageViewerInfoBar',
  component: InfoBarExample,
  args: {
    imageId: 1621,
    name: 'Duomo of Milan — façade detail',
    active: true,
    collections: COLLECTIONS,
    onOpenCollection: fn(),
    hrefForCollection: (id: number) => `#collection-${id}`,
    onShowNote: fn(),
    onShowCollections: fn(),
  } satisfies Partial<ImageViewerInfoBarProps>,
  decorators: [
    (Story) => (
      // The bar has no background of its own — match the app's page surface
      // and let the row span the full container like the viewer Paper does.
      <Box sx={{ bgcolor: 'background.default', p: 1 }}>
        <Story />
      </Box>
    ),
  ],
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof InfoBarExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386.',
  },
}

export const LongNote: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386 and continued for centuries.\nThe main façade was completed in the 19th century after many redesigns.\nRestoration work continues today on the marble exterior, the spires, and the stained-glass windows.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const showMore = canvas.getByRole('button', { name: 'Show full note' })
    await userEvent.click(showMore)
    const dialog = await canvas.findByRole('dialog', { name: 'Notes' })
    await expect(within(dialog).getByText(/stained-glass windows/)).toBeInTheDocument()
  },
}

export const ManyCollections: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386.',
    collections: [
      ...COLLECTIONS,
      { id: 1623, name: 'Gothic cathedrals' },
      { id: 1624, name: 'Restoration case studies' },
      { id: 1625, name: 'Lombardy fieldwork' },
      { id: 1626, name: 'Marble conservation' },
      { id: 1627, name: 'Spire survey 2024' },
      { id: 1628, name: 'Stained glass documentation' },
    ],
  },
  decorators: [
    (Story) => (
      // Narrow the row so the names cannot all fit — "… + N more" shows.
      <Box sx={{ width: 480, maxWidth: '100%', bgcolor: 'background.default', p: 1 }}>
        <Story />
      </Box>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const showMore = canvas.getByRole('button', { name: 'Show all 8 collections' })
    await userEvent.click(showMore)
    const dialog = await canvas.findByRole('dialog', { name: 'Collections' })
    await expect(
      within(dialog).getByRole('link', { name: 'Stained glass documentation' }),
    ).toBeInTheDocument()
  },
}

export const TitleOnly: Story = {
  args: {
    note: null,
    collections: [],
  },
}
