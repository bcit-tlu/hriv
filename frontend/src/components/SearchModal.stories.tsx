import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import SearchModal from './SearchModal'
import { categoryTree, PROGRAMS, USERS } from './storyFixtures'

// Shown in its empty prompt state (no query), so no token-backed result
// thumbnails are rendered — keeps the story API-free.
const meta = {
  title: 'Components/SearchModal',
  component: SearchModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Global search across categories, images, programs, users and guide docs. Rendered ' +
          'here in its empty prompt state; populated results use token-backed thumbnails.',
      },
    },
  },
  args: {
    open: true,
    categories: categoryTree(),
    uncategorizedImages: [],
    programs: PROGRAMS,
    users: USERS,
    isStudent: false,
    onClose: fn(),
    onSelectCategory: fn(),
    onSelectImage: fn(),
    onSelectProgram: fn(),
    onSelectUser: fn(),
    onSelectGuide: fn(),
  },
} satisfies Meta<typeof SearchModal>

export default meta

type Story = StoryObj<typeof meta>

export const EmptyPrompt: Story = {
  name: 'Empty Prompt',
}

export const StudentScope: Story = {
  name: 'Student Scope',
  args: { isStudent: true },
}
