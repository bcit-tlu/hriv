import type { Meta, StoryObj } from '@storybook/react-vite'
import AnnouncementsPage from './AnnouncementsPage'
import { storyFeed } from './announcementStoryFixtures'
import type { User } from '../types'

const student: User = {
  id: 20,
  name: 'Sam Student',
  email: 'student@example.ca',
  role: 'student',
  active: true,
  program_ids: [1],
  program_names: ['Medical Laboratory Science'],
  group_ids: [3],
  group_names: ['Histology 2024'],
}

const meta = {
  title: 'Components/AnnouncementsPage',
  component: AnnouncementsPage,
  args: { currentUser: student, feed: storyFeed(), canCompose: false },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AnnouncementsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  name: 'Inbox (student)',
}

export const FocusedPost: Story = {
  name: 'Inbox with deep-linked post',
  args: { focusId: 1 },
}

export const Loading: Story = {
  args: { feed: storyFeed({ announcements: [], unseenCount: 0, loading: true }) },
}

export const Empty: Story = {
  args: { feed: storyFeed({ announcements: [], unseenCount: 0 }) },
}

export const LoadError: Story = {
  args: {
    feed: storyFeed({
      announcements: [],
      unseenCount: 0,
      error: 'Could not load announcements',
    }),
  },
}
