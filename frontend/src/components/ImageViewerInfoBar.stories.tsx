import type { Meta, StoryObj } from '@storybook/react-vite'
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
  return <ImageCollectionsList collections={items} onOpenCollection={() => undefined} />
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
    collections: collectionsList([
      ...COLLECTIONS,
      { id: 1623, name: 'Gothic cathedrals' },
      { id: 1624, name: 'Restoration case studies' },
      { id: 1625, name: 'Lombardy fieldwork' },
    ]),
  },
}

export const Empty: Story = {}
