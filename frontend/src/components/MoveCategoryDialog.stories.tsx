import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import MoveCategoryDialog from './MoveCategoryDialog'
import { categoryTree, makeCategory, PROGRAMS, GROUPS } from './storyFixtures'

const CATEGORIES = categoryTree()

const meta = {
  title: 'Components/MoveCategoryDialog',
  component: MoveCategoryDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Moves a category to a new parent using the tree-aware picker, warning when the move ' +
          'would change effective access restrictions.',
      },
    },
  },
  args: {
    open: true,
    category: makeCategory({ id: 201, label: 'Italian Renaissance', parentId: 200 }),
    categories: CATEGORIES,
    programs: PROGRAMS,
    groups: GROUPS,
    onClose: fn(),
    onMove: fn(),
  },
} satisfies Meta<typeof MoveCategoryDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
