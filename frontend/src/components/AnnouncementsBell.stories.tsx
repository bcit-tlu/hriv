import type { Meta, StoryObj } from '@storybook/react-vite'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import { expect, userEvent, within } from 'storybook/test'
import AnnouncementsBell from './AnnouncementsBell'
import { storyInbox } from './announcementStoryFixtures'

const meta = {
  title: 'Components/AnnouncementsBell',
  component: AnnouncementsBell,
  args: { onOpenAnnouncements: () => {} },
  decorators: [
    (Story) => (
      <AppBar position="static" color="primary" sx={{ width: 480 }}>
        <Toolbar sx={{ justifyContent: 'flex-end' }}>
          <Story />
        </Toolbar>
      </AppBar>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AnnouncementsBell>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { announcements: storyInbox, unseenCount: 2 },
}

export const PeekOpen: Story = {
  args: { announcements: storyInbox, unseenCount: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Announcements, 2 unseen/ }))
    await expect(within(document.body).getByText('See all')).toBeInTheDocument()
  },
}

export const CaughtUp: Story = {
  args: { announcements: storyInbox.map((a) => ({ ...a, seen: true })), unseenCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Announcements' }))
    await expect(within(document.body).getByText("You're all caught up.")).toBeInTheDocument()
  },
}
