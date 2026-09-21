import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import AddCategoryDialog from './AddCategoryDialog'
import { PROGRAMS, GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/AddCategoryDialog',
  component: AddCategoryDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Creates a new category, optionally narrowing program/group access. Shows inherited ' +
          'restrictions from the parent and guards against duplicate sibling names.',
      },
    },
  },
  args: {
    open: true,
    programs: PROGRAMS,
    groups: GROUPS,
    onClose: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof AddCategoryDialog>

export default meta

type Story = StoryObj<typeof meta>

export const AtRoot: Story = {
  name: 'At Root',
}

export const UnderParent: Story = {
  name: 'Under Parent (inherited restrictions)',
  args: {
    parentLabel: 'Renaissance',
    siblingNames: ['Italian Renaissance', 'Northern Renaissance'],
    inheritedProgramIds: [1],
    inheritedGroupIds: [10],
  },
}
