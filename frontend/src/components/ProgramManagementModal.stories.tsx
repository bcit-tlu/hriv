import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ProgramManagementModal from './ProgramManagementModal'
import { PROGRAMS } from './storyFixtures'

const meta = {
  title: 'Components/ProgramManagementModal',
  component: ProgramManagementModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Admin CRUD modal for programs, including their optional OIDC group mapping used for ' +
          'automatic access provisioning.',
      },
    },
  },
  args: {
    open: true,
    programs: PROGRAMS,
    onClose: fn(),
    onAdd: fn(),
    onEdit: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof ProgramManagementModal>

export default meta

type Story = StoryObj<typeof meta>

export const WithPrograms: Story = {
  name: 'With Programs',
}

export const Empty: Story = {
  args: { programs: [] },
}
