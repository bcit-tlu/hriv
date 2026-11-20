import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import AnnouncementComposer from './AnnouncementComposer'
import { storyAnnouncement } from './announcementStoryFixtures'
import type { ApiGroup, ApiProgram } from '../api'

const programs = [{ id: 1, name: 'Medical Laboratory Science' }] as ApiProgram[]
const groups = [
  { id: 3, name: 'Histology 2024', description: null, instructor_ids: [7], member_ids: [] },
  { id: 4, name: 'Cytology 2024', description: null, instructor_ids: [7], member_ids: [] },
] as unknown as ApiGroup[]

const meta = {
  title: 'Components/AnnouncementComposer',
  component: AnnouncementComposer,
  args: {
    open: true,
    onClose: () => {},
    onSaved: () => {},
    isAdmin: false,
    programs,
    groups,
  },
  parameters: { layout: 'fullscreen', chromatic: { delay: 300 } },
} satisfies Meta<typeof AnnouncementComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

export const Admin: Story = {
  name: 'Admin (Everyone / Staff, all kinds, banner)',
  args: { isAdmin: true },
}

export const PostToGroup: Story = {
  name: 'Contextual "Post to group"',
  args: { initialGroupIds: [4] },
}

export const PinnedNeedsExpiry: Story = {
  name: 'Pinned without expiry (Post disabled)',
  args: { initialGroupIds: [4] },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByRole('textbox', { name: /Title/ }), 'Lab closed Friday')
    await userEvent.click(page.getByRole('checkbox', { name: 'Pin to top' }))
    await expect(page.getByText('Required for pinned posts')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Post' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled()
  },
}

export const Edit: Story = {
  args: {
    mode: 'edit',
    source: storyAnnouncement({
      can_edit: true,
      pinned: true,
      expires_at: '2031-01-31T08:00:00+00:00',
    }),
  },
}

export const Duplicate: Story = {
  args: { mode: 'duplicate', source: storyAnnouncement({ can_edit: true }) },
}
