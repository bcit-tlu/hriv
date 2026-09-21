import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ManageCategoriesDialog from './ManageCategoriesDialog'
import { categoryTree, PROGRAMS, GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/ManageCategoriesDialog',
  component: ManageCategoriesDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Admin dialog for the full category tree: add/rename/delete, toggle visibility, set ' +
          'program/group restrictions, and drag-reorder through the shared ordering contract.',
      },
    },
  },
  args: {
    open: true,
    categories: categoryTree(),
    programs: PROGRAMS,
    groups: GROUPS,
    onClose: fn(),
    onAddCategory: fn(async () => 999),
    onDeleteCategory: fn(async () => undefined),
    onEditCategory: fn(async () => undefined),
    onToggleVisibility: fn(async () => undefined),
  },
} satisfies Meta<typeof ManageCategoriesDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = {
  name: 'Empty (no categories)',
  args: { categories: [] },
}
