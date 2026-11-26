import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import BoardCard from './BoardCard'
import { installBoardsFetch } from './boardsFixtures'
import { BOARD_FIXTURE } from './markerFixtures'

// Deterministic inline cover — no photo asset, no network.
const COVER = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'><rect width='320' height='240' fill='#9e9e9e'/><circle cx='160' cy='120' r='70' fill='#d7ccc8'/></svg>",
)}`

const meta = {
  title: 'Components/BoardCard',
  component: BoardCard,
  parameters: {
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: {
    board: {
      ...BOARD_FIXTURE,
      name: 'Histology week 3',
      marker_count: 12,
      visibility: 'public',
      cover_thumb: COVER,
    },
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 300, p: 1 }}>
        <Story />
      </Box>
    ),
  ],
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof BoardCard>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector('img')).toHaveAttribute('src', COVER)
    await userEvent.click(canvas.getByRole('button', { name: 'Open Board: Histology week 3' }))
    await expect(args.onOpen).toHaveBeenCalledWith(args.board)
  },
}

export const NoCover: Story = {
  args: {
    board: { ...BOARD_FIXTURE, name: 'Gothic details', marker_count: 3, cover_blank: true },
  },
}

export const Restricted: Story = {
  args: {
    board: {
      ...BOARD_FIXTURE,
      name: 'Blood smear study',
      marker_count: 8,
      visibility: 'restricted',
      cover_thumb: COVER,
    },
  },
}

export const LongName: Story = {
  args: {
    board: {
      ...BOARD_FIXTURE,
      name: 'Comparative neuroanatomy across vertebrate species — lab practical review',
      marker_count: 1,
      cover_thumb: COVER,
    },
  },
}
