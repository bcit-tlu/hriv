import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import AddEditPersonModal from './AddEditPersonModal'
import { PROGRAMS, USERS } from './storyFixtures'

const meta = {
  title: 'Components/AddEditPersonModal',
  component: AddEditPersonModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Create or edit a person (user), assigning role and program membership. Presence of ' +
          '`user` switches the modal between add and edit modes.',
      },
    },
  },
  args: {
    open: true,
    programs: PROGRAMS,
    onClose: fn(),
    onSave: fn(async () => undefined),
  },
} satisfies Meta<typeof AddEditPersonModal>

export default meta

type Story = StoryObj<typeof meta>

export const Add: Story = {
  args: { user: null },
}

export const Edit: Story = {
  args: { user: USERS[0] },
}
