import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import AnnouncementCard from './AnnouncementCard'
import { storyAnnouncement, storyInbox } from './announcementStoryFixtures'

const meta = {
  title: 'Components/AnnouncementCard',
  component: AnnouncementCard,
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 720 }}>
        <Story />
      </Box>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AnnouncementCard>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { announcement: storyAnnouncement() },
}

export const Seen: Story = {
  name: 'Seen (quiet)',
  args: { announcement: storyAnnouncement({ seen: true }) },
}

export const CelebrationWithReactions: Story = {
  args: { announcement: storyInbox[0] },
}

export const ReleaseNoteFromSite: Story = {
  args: { announcement: storyInbox[2], viewerIsStaff: true },
}

export const ManageScheduled: Story = {
  name: 'Manage: scheduled, editable',
  args: {
    announcement: storyAnnouncement({
      status: 'scheduled',
      publish_at: '2031-01-06T17:00:00+00:00',
      notified_at: null,
      can_edit: true,
      seen_count: 0,
      audience_size: 24,
    }),
    manage: true,
    viewerIsStaff: true,
    onEdit: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
  },
}

export const ManageCoManaged: Story = {
  name: 'Manage: co-managed (read-only)',
  args: {
    announcement: storyAnnouncement({
      author_name: 'Grace Hopper',
      can_edit: false,
      seen_count: 18,
      audience_size: 24,
    }),
    manage: true,
    viewerIsStaff: true,
    onEdit: () => {},
  },
}

export const Warning: Story = {
  args: {
    announcement: storyAnnouncement({
      kind: 'warning',
      severity: 'warning',
      title: 'Planned maintenance Saturday 06:00–08:00',
      message: 'HRIV will be unavailable while the database is upgraded.',
      audience: 'everyone',
      group_ids: [],
      group_names: [],
      banner: true,
    }),
    highlighted: true,
  },
}
