import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import AnnouncementReactions from './AnnouncementReactions'
import { storyAnnouncement } from './announcementStoryFixtures'

const meta = {
  title: 'Components/AnnouncementReactions',
  component: AnnouncementReactions,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Emoji reaction pills plus the "Add reaction" picker shared by announcement cards and the banner.',
      },
    },
  },
  args: { onToggleReaction: () => {} },
} satisfies Meta<typeof AnnouncementReactions>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  name: 'Basic (not yet reacted)',
  args: {
    announcement: storyAnnouncement({ reactions: { hooray: 3, heart: 1 }, my_reactions: [] }),
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add reaction' }))
    // The picker is a portal, so look it up on the document body.
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitem', { name: 'Rocket' })).toBeInTheDocument()
  },
}

export const Reacted: Story = {
  name: 'Reacted (own pill, picker hidden)',
  args: {
    announcement: storyAnnouncement({
      reactions: { hooray: 3, heart: 1 },
      my_reactions: ['hooray'],
    }),
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /hooray reaction, 3, yours/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.queryByRole('button', { name: 'Add reaction' })).toBeNull()
  },
}

export const ReadOnly: Story = {
  name: 'Read-only (no toggle handler)',
  args: {
    announcement: storyAnnouncement({ reactions: { '+1': 4, eyes: 2 } }),
    onToggleReaction: undefined,
  },
}

export const NotLive: Story = {
  name: 'Not live (pills only)',
  args: {
    announcement: storyAnnouncement({ status: 'expired', reactions: { clap: 5 } }),
  },
}
