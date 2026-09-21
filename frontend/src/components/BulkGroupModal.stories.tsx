import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import BulkGroupModal from './BulkGroupModal'
import { GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/BulkGroupModal',
  component: BulkGroupModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Applies a group-restriction change to multiple selected categories. On save it can ' +
          'return the group ids that failed so the selection is pruned for retry.',
      },
    },
  },
  args: {
    open: true,
    groups: GROUPS,
    selectedCount: 4,
    onClose: fn(),
    onSave: fn(async () => undefined),
  },
} satisfies Meta<typeof BulkGroupModal>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoGroups: Story = {
  name: 'No Groups',
  args: { groups: [] },
}
