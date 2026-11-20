import type { Meta, StoryObj } from '@storybook/react-vite'
import Stack from '@mui/material/Stack'
import { expect } from 'storybook/test'
import BoardCover from './BoardCover'
import { installBoardsFetch } from './boardsFixtures'
import { BOARD_FIXTURE } from './markerFixtures'

const COVER = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='70' height='70'><rect width='70' height='70' fill='#b0413e'/><circle cx='35' cy='35' r='18' fill='#f3d9c4'/></svg>",
)}`

const meta = {
  title: 'Components/BoardCover',
  component: BoardCover,
  parameters: {
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: { board: { ...BOARD_FIXTURE, cover_thumb: COVER } },
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof BoardCover>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img')).toHaveAttribute('src', COVER)
  },
}

export const Placeholder: Story = {
  args: { board: { ...BOARD_FIXTURE, cover_blank: true } },
}

export const Sizes: Story = {
  render: (args) => (
    <Stack direction="row" spacing={2} alignItems="center">
      {[70, 40, 32].map((size) => (
        <BoardCover key={size} {...args} size={size} radius={1} />
      ))}
    </Stack>
  ),
}
