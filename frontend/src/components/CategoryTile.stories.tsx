import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import CategoryTile from './CategoryTile'
import type { Category, Group, ImageItem, Program } from '../types'

const programs: Program[] = [
  {
    id: 10,
    name: 'Digital Design',
    oidc_group: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 20,
    name: 'Photography',
    oidc_group: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const groups: Group[] = [
  {
    id: 30,
    name: 'Seminar A',
    description: null,
    createdByUserId: 2,
    memberIds: [3, 4],
    instructorIds: [2],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 40,
    name: 'Studio Review',
    description: null,
    createdByUserId: 2,
    memberIds: [4],
    instructorIds: [2],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

interface CategoryTileStoryArgs {
  label: string
  status: 'active' | 'hidden'
  childCount: number
  imageCount: number
  cardImage: boolean
  programRestriction: 'none' | 'direct' | 'inherited' | 'direct and inherited'
  groupRestriction: 'none' | 'direct' | 'inherited' | 'direct and inherited'
  parentHidden: boolean
  showMoveAction: boolean
  showEditNameAction: boolean
  showCardImageAction: boolean
  enableFileDropTarget: boolean
}

function makeImage(id: number, name = `Image ${id}`): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    tileSources: `/api/tiles/${id}/image.dzi`,
    active: true,
    sortOrder: id,
    version: 1,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    label: 'Architecture',
    parentId: null,
    children: [],
    images: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    metadataExtra: {},
    ...overrides,
  }
}

function idsForRestriction(
  kind: CategoryTileStoryArgs['programRestriction'] | CategoryTileStoryArgs['groupRestriction'],
) {
  if (kind === 'direct' || kind === 'direct and inherited') return [10]
  return []
}

function inheritedIdsForRestriction(
  kind: CategoryTileStoryArgs['programRestriction'] | CategoryTileStoryArgs['groupRestriction'],
) {
  if (kind === 'inherited') return [10]
  if (kind === 'direct and inherited') return [20]
  return []
}

function makeStoryCategory(args: CategoryTileStoryArgs): Category {
  const baseImages = Array.from({ length: args.imageCount }, (_, index) => makeImage(index + 1))
  const images = args.cardImage
    ? [makeImage(100, 'Selected card image'), ...baseImages]
    : baseImages

  return makeCategory({
    label: args.label,
    status: args.status === 'hidden' ? 'hidden' : null,
    children: Array.from({ length: args.childCount }, (_, index) =>
      makeCategory({ id: index + 2, label: `Child ${index + 1}` }),
    ),
    images,
    cardImageId: args.cardImage ? 100 : null,
    programIds: idsForRestriction(args.programRestriction),
    groupIds: idsForRestriction(args.groupRestriction).map((id) => id + 20),
  })
}

function CategoryTileExample(args: CategoryTileStoryArgs) {
  const category = makeStoryCategory(args)
  const inheritedProgramIds = inheritedIdsForRestriction(args.programRestriction)
  const inheritedGroupIds = inheritedIdsForRestriction(args.groupRestriction).map((id) => id + 20)

  return (
    <Box sx={{ width: 300 }}>
      <CategoryTile
        category={category}
        groups={groups}
        inheritedGroupIds={inheritedGroupIds}
        inheritedProgramIds={inheritedProgramIds}
        onClick={() => undefined}
        onDropFiles={args.enableFileDropTarget ? () => undefined : undefined}
        onEditName={args.showEditNameAction ? () => undefined : undefined}
        onMove={args.showMoveAction ? () => undefined : undefined}
        onSetCardImage={args.showCardImageAction ? () => undefined : undefined}
        parentHidden={args.parentHidden}
        programs={programs}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/CategoryTile',
  component: CategoryTileExample,

  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Displays a browse-page category tile, including child/image counts, category visibility, restrictions, card images, and instructor/admin actions.',
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Category label displayed in the tile title.',
    },
    status: {
      control: 'inline-radio',
      options: ['active', 'hidden'],
      description: 'Visibility state for the category.',
    },
    childCount: {
      control: { type: 'number', min: 0, max: 12, step: 1 },
      description: 'Number of direct child categories represented in the tile count.',
    },
    imageCount: {
      control: { type: 'number', min: 0, max: 12, step: 1 },
      description: 'Number of direct images represented in the tile count.',
    },
    cardImage: {
      control: 'boolean',
      description: 'Show the selected card thumbnail instead of the folder placeholder.',
    },
    programRestriction: {
      control: 'select',
      options: ['none', 'direct', 'inherited', 'direct and inherited'],
      description: 'Program restriction chips shown on the tile.',
    },
    groupRestriction: {
      control: 'select',
      options: ['none', 'direct', 'inherited', 'direct and inherited'],
      description: 'Group restriction chips shown on the tile.',
    },
    parentHidden: {
      control: 'boolean',
      description: 'Simulates a hidden ancestor so the tile is desaturated by inheritance.',
    },
    showMoveAction: {
      control: 'boolean',
      description: 'Show the instructor/admin move-category action.',
    },
    showEditNameAction: {
      control: 'boolean',
      description: 'Show the instructor/admin inline edit-name action.',
    },
    showCardImageAction: {
      control: 'boolean',
      description: 'Show the instructor/admin set-card-image action.',
    },
    enableFileDropTarget: {
      control: 'boolean',
      description: 'Enable the native file-drop target behavior used for category uploads.',
    },
  },
  args: {
    label: 'Architecture',
    status: 'active',
    childCount: 2,
    imageCount: 4,
    cardImage: false,
    programRestriction: 'none',
    groupRestriction: 'none',
    parentHidden: false,
    showMoveAction: false,
    showEditNameAction: false,
    showCardImageAction: false,
    enableFileDropTarget: false,
  },
} satisfies Meta<typeof CategoryTileExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <CategoryTileExample {...args} />,
}

export const WithCardImage: Story = {
  name: 'With Card Image',
  args: {
    cardImage: true,
    imageCount: 3,
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const WithRestrictions: Story = {
  name: 'With Restrictions',
  args: {
    programRestriction: 'direct and inherited',
    groupRestriction: 'direct and inherited',
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const Hidden: Story = {
  args: {
    label: 'Hidden Category',
    status: 'hidden',
    programRestriction: 'direct',
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const WithInheritedHiddenState: Story = {
  name: 'With Inherited Hidden State',
  args: {
    label: 'Child of Hidden Category',
    parentHidden: true,
    programRestriction: 'inherited',
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const WithActions: Story = {
  name: 'With Actions',
  args: {
    cardImage: true,
    showCardImageAction: true,
    showEditNameAction: true,
    showMoveAction: true,
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const LongTitle: Story = {
  name: 'Long Title',
  args: {
    label:
      'A very long category title that wraps across multiple lines before being clamped by the tile layout',
    childCount: 1,
    imageCount: 1,
  },
  render: (args) => <CategoryTileExample {...args} />,
}

export const Empty: Story = {
  args: {
    label: 'Empty Category',
    childCount: 0,
    imageCount: 0,
  },
  render: (args) => <CategoryTileExample {...args} />,
}
