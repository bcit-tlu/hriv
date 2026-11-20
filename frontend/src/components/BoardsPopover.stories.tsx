import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import Box from '@mui/material/Box'
import BoardsPopover from './BoardsPopover'
import { BOARD_USER, installBoardsFetch } from './boardsFixtures'

function Anchored(props: React.ComponentProps<typeof BoardsPopover>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 2, height: 480 }}>
      <span ref={setAnchor}>Boards &amp; Markers</span>
      <BoardsPopover {...props} anchorEl={anchor} />
    </Box>
  )
}

const meta = {
  title: 'Components/BoardsPopover',
  component: BoardsPopover,
  parameters: { layout: 'fullscreen' },
  args: {
    anchorEl: null,
    currentUser: BOARD_USER,
    onClose: fn(),
    onOpenBoard: fn(),
    onOpenBoardsPage: fn(),
  },
  beforeEach: () => installBoardsFetch(),
  render: (args) => <Anchored {...args} />,
} satisfies Meta<typeof BoardsPopover>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByText('Next studio project')).toBeVisible())
    await expect(page.queryByText('Shared discoveries')).toBeNull()
    await expect(page.getByRole('button', { name: 'Open Boards & Markers' })).toBeVisible()
  },
}

export const Loading: Story = {
  args: { services: { fetchBoards: () => new Promise(() => {}) } },
}

export const Empty: Story = {
  args: { services: { fetchBoards: async () => [] } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByText('You have no Boards yet.')).toBeVisible())
  },
}

export const LoadError: Story = {
  args: {
    services: {
      fetchBoards: async () => {
        throw new Error('Could not load Boards.')
      },
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByRole('alert')).toHaveTextContent('Could not load Boards.'))
  },
}
