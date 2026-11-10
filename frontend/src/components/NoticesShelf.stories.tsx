import type { Meta, StoryObj } from '@storybook/react-vite'
import NoticesShelf from './NoticesShelf'
import { storyAnnouncement, storyInbox } from './announcementStoryFixtures'

const meta = {
  title: 'Components/NoticesShelf',
  component: NoticesShelf,
  args: { onToggleReaction: () => {}, onOpenAnnouncements: () => {} },
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

export const Empty: Story = {
  args: { announcements: [storyAnnouncement({ pinned: false })] },
}
