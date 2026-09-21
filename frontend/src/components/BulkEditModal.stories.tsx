import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import BulkEditModal from './BulkEditModal'
import { PROGRAMS } from './storyFixtures'

const meta = {
  title: 'Components/BulkEditModal',
  component: BulkEditModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Applies a program-restriction change to multiple selected categories at once.',
      },
    },
  },
  args: {
    open: true,
    programs: PROGRAMS,
    selectedCount: 7,
    onClose: fn(),
    onSave: fn(),
  },
} satisfies Meta<typeof BulkEditModal>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoPrograms: Story = {
  name: 'No Programs',
  args: { programs: [] },
}
