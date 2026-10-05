import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { Category } from '../types'
import CategoryBreadcrumb, { buildCategoryPaths } from './CategoryBreadcrumb'

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    label: 'Anatomy',
    parentId: null,
    children: [],
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    metadataExtra: {},
    ...overrides,
  }
}

const tree: Category[] = [
  makeCategory({
    id: 1,
    label: 'Anatomy',
    children: [
      makeCategory({ id: 2, label: 'Skeletal', parentId: 1 }),
      makeCategory({ id: 3, label: 'Muscular', parentId: 1 }),
    ],
  }),
  makeCategory({ id: 4, label: 'Histology', status: 'hidden' }),
]

interface StoryArgs {
  categoryId: number | null
  onNavigate: (categoryPath: Category[]) => void
}

function CategoryBreadcrumbExample(args: StoryArgs) {
  const categoryPaths = useMemo(() => buildCategoryPaths(tree), [])
  return (
    <Box sx={{ p: 3 }}>
      <CategoryBreadcrumb
        categoryId={args.categoryId}
        categoryPaths={categoryPaths}
        onNavigate={args.onNavigate}
        hiddenColor="#a52438"
      />
    </Box>
  )
}

const meta = {
  title: 'Components/CategoryBreadcrumb',
  component: CategoryBreadcrumbExample,
  parameters: {
    docs: {
      description: {
        component:
          'Colon-separated browse-location breadcrumb shared by the manage tables (extracted from ManagePage for the collections table, #1554). Each segment links into Browse at that depth; a hidden-by-category eye icon follows the path when the row sits under a restricted subtree.',
      },
    },
  },
  argTypes: {
    categoryId: {
      control: 'select',
      options: [null, 1, 2, 3, 4, 99],
      description: 'Filed category id — `null` renders the uncategorized em-dash.',
    },
  },
  args: {
    categoryId: 2,
    onNavigate: fn(),
  },
} satisfies Meta<typeof CategoryBreadcrumbExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Anatomy' }))
    // Clicking an ancestor segment navigates only to that depth.
    await expect(args.onNavigate).toHaveBeenCalledWith([tree[0]])
    await userEvent.click(canvas.getByRole('button', { name: 'Skeletal' }))
    await expect(args.onNavigate).toHaveBeenCalledWith([tree[0], tree[0].children[0]])
  },
}

export const HiddenSubtree: Story = {
  name: 'Hidden Subtree',
  args: { categoryId: 4 },
}

export const Uncategorized: Story = {
  args: { categoryId: null },
}
