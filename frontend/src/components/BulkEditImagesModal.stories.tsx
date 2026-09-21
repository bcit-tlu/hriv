import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import BulkEditImagesModal from './BulkEditImagesModal'
import { categoryTree, PROGRAMS, GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/BulkEditImagesModal',
  component: BulkEditImagesModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Applies metadata (category, copyright, note, visibility) or deletion to multiple ' +
          'selected images at once, reusing the tree-aware category picker.',
      },
    },
  },
  args: {
    open: true,
    categories: categoryTree(),
    selectedCount: 12,
    programs: PROGRAMS,
    groups: GROUPS,
    onClose: fn(),
    onSave: fn(async () => undefined),
    onDelete: fn(async () => undefined),
  },
} satisfies Meta<typeof BulkEditImagesModal>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AllHiddenCategories: Story = {
  name: 'All In Hidden Categories',
  args: { allCategoryHidden: true },
}
