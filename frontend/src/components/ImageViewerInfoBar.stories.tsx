import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { ImageViewerInfoBarProps } from './ImageViewerInfoBar'
import ImageViewerInfoBar from './ImageViewerInfoBar'
import ImageCollectionsList from './ImageCollectionsList'

const COLLECTIONS = [
  { id: 1621, name: 'Duomo archive' },
  { id: 1622, name: 'Italian architecture' },
]

function collectionsList(
  items: { id: number; name: string }[],
): ImageViewerInfoBarProps['collections'] {
  return (
    <ImageCollectionsList
      collections={items}
      limit={items.length}
      onOpenCollection={() => undefined}
    />
  )
}

const meta = {
  title: 'Components/ImageViewerInfoBar',
  component: ImageViewerInfoBar,
  args: {
    imageId: 1621,
  } satisfies Partial<ImageViewerInfoBarProps>,
  decorators: [
    (Story) => (
      <Box sx={{ width: 1100, maxWidth: '100%' }}>
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
} satisfies Meta<typeof ImageViewerInfoBar>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386.',
    collections: collectionsList(COLLECTIONS),
  },
}

export const LongNote: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386 and continued for centuries.\nThe main façade was completed in the 19th century after many redesigns.\nRestoration work continues today on the marble exterior, the spires, and the stained-glass windows.',
    collections: collectionsList(COLLECTIONS),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const showMore = canvas.getByRole('button', { name: 'Show full note' })
    await userEvent.click(showMore)
    const popover = await within(document.body).findByRole('presentation')
    await expect(within(popover).getByText('Note')).toBeInTheDocument()
    await expect(within(popover).getByText(/stained-glass windows/)).toBeInTheDocument()
  },
}

export const ManyCollections: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386.',
    collections: collectionsList([
      ...COLLECTIONS,
      { id: 1623, name: 'Gothic cathedrals' },
      { id: 1624, name: 'Restoration case studies' },
      { id: 1625, name: 'Lombardy fieldwork' },
      { id: 1626, name: 'Marble conservation' },
      { id: 1627, name: 'Spire survey 2024' },
      { id: 1628, name: 'Stained glass documentation' },
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const showMore = canvas.getByRole('button', { name: 'Show all collections' })
    await userEvent.click(showMore)
    const popover = await within(document.body).findByRole('presentation')
    await expect(within(popover).getByText('Collections')).toBeInTheDocument()
    await expect(
      within(popover).getByRole('button', { name: 'Stained glass documentation' }),
    ).toBeInTheDocument()
  },
}

export const NotesOnly: Story = {
  args: {
    note: 'The cathedral’s construction began in 1386.',
  },
}
