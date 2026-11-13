import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ImageItem } from '../types'
import {
  CollectionImageDetails,
  CollectionImageDetailsDrawer,
  CollectionImageDetailsTrigger,
} from './CollectionImageDetails'

const IMAGE: ImageItem = {
  id: 501,
  name: 'Skull — lateral',
  thumb: '',
  tileSources: '',
  active: true,
  sortOrder: 0,
  version: 1,
  copyright: '© Anatomical Teaching Collection',
  createdAt: '2025-01-02T03:04:05Z',
  updatedAt: '2025-02-03T04:05:06Z',
  width: 4820,
  height: 3210,
  fileSize: 4_718_592,
}

const IMAGE_TWO: ImageItem = {
  ...IMAGE,
  id: 502,
  name: 'Skull — anterior',
  copyright: null,
}

interface StoryArgs {
  programNames: string[]
  groupNames: string[]
}

/** One fake viewer pane: provider + trigger top-right + drawer inside. */
function Pane({
  image,
  programNames,
  groupNames,
  caption,
}: StoryArgs & {
  image: ImageItem
  caption: string
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 380,
        height: 300,
        bgcolor: 'grey.900',
        overflow: 'hidden',
      }}
    >
      <CollectionImageDetails image={image} programNames={programNames} groupNames={groupNames}>
        <Box sx={{ position: 'absolute', top: 8, right: 8, lineHeight: 0 }}>
          <CollectionImageDetailsTrigger />
        </Box>
        <CollectionImageDetailsDrawer />
      </CollectionImageDetails>
      <Typography
        variant="caption"
        sx={{ position: 'absolute', bottom: 4, left: 8, color: 'common.white' }}
      >
        {caption}
      </Typography>
    </Box>
  )
}

function CollectionImageDetailsExample(args: StoryArgs) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Pane
        image={IMAGE}
        programNames={args.programNames}
        groupNames={args.groupNames}
        caption={IMAGE.name}
      />
      <Pane
        image={IMAGE_TWO}
        programNames={args.programNames}
        groupNames={args.groupNames}
        caption={IMAGE_TWO.name}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/CollectionImageDetails',
  component: CollectionImageDetailsExample,
  args: {
    programNames: ['Anatomy'],
    groupNames: ['MSK Block'],
  },
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof CollectionImageDetailsExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const triggers = canvas.getAllByRole('button', { name: 'Image details' })
    await expect(triggers).toHaveLength(2)
    // Per-pane providers keep drawer state independent (#1862): opening the
    // first pane's drawer leaves the second pane closed.
    await userEvent.click(triggers[0])
    await expect(triggers[0]).toHaveAttribute('aria-expanded', 'true')
    await expect(triggers[1]).toHaveAttribute('aria-expanded', 'false')
    // Exactly one drawer is open — the other pane's stays closed.
    const headings = await canvas.findAllByRole('heading', { name: 'Image details' })
    await expect(headings).toHaveLength(1)
    await userEvent.click(triggers[1])
    await expect(await canvas.findAllByRole('heading', { name: 'Image details' })).toHaveLength(2)
  },
}
