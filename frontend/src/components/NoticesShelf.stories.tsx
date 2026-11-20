import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import NoticesShelf from './NoticesShelf'
import { storyAnnouncement, storyInbox } from './announcementStoryFixtures'

const meta = {
  title: 'Components/NoticesShelf',
  component: NoticesShelf,
  args: { onOpenAnnouncements: () => {} },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof NoticesShelf>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { announcements: storyInbox },
}

export const ThreeNotices: Story = {
  args: {
    announcements: [
      storyInbox[0],
      storyAnnouncement({ id: 11, pinned: true, title: 'Lab coats are mandatory from Monday' }),
      storyAnnouncement({
        id: 12,
        pinned: true,
        kind: 'event',
        title: 'Open house: 14 March',
        message: 'Bring a friend to the histology lab tour.',
        reactions: { eyes: 4 },
      }),
      storyAnnouncement({ id: 13, pinned: true, title: 'Never shown (cap of three)' }),
    ],
  },
}

/** Seen pinned posts collapse to their title; "Expand" reopens the body. */
export const SeenCollapsed: Story = {
  args: {
    announcements: [
      storyInbox[0],
      storyAnnouncement({
        id: 14,
        pinned: true,
        seen: true,
        title: 'Lab coats are mandatory from Monday',
        message: 'Already read: this body starts collapsed.',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/Already read/)).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Expand' }))
    await expect(canvas.getByText(/Already read/)).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { announcements: [storyAnnouncement({ pinned: false })] },
}
