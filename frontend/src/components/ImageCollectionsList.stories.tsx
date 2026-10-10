import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Box from '@mui/material/Box'
import ImageCollectionsList from './ImageCollectionsList'

const SAMPLE = [
  { id: 1, name: 'Skull comparison' },
  { id: 2, name: 'Teaching set A' },
  { id: 3, name: 'Midterm review' },
  { id: 4, name: 'Lateral views' },
  { id: 5, name: 'Archive 2026' },
]

const meta = {
  title: 'Components/ImageCollectionsList',
  component: ImageCollectionsList,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Read-only "Collections" row for the image viewer metadata area (#1586). Lists the collections an image belongs to, each name linking to that collection, truncating to three names with an inline “… and N more” expander when there are more.',
      },
    },
  },
  decorators: [
    (Story) => (
      // Mirror the viewer metadata area: muted, body2, left-aligned.
      <Box sx={{ maxWidth: 480 }}>
        <Story />
      </Box>
    ),
  ],
  argTypes: {
    collections: {
      control: 'object',
      description:
        'Collections the image belongs to ({ id, name }), already visibility-filtered and ordered.',
    },
    limit: {
      control: { type: 'number', min: 1, max: 10, step: 1 },
      description: 'How many names to show before the "more" affordance.',
    },
    onOpenCollection: {
      description: 'Open a collection in-app (SPA navigation); called on a plain left click.',
    },
    hrefForCollection: {
      description:
        'Optional href builder so each name is a real anchor (modifier/middle-click opens a new tab).',
    },
  },
  args: {
    collections: SAMPLE,
    limit: 3,
    onOpenCollection: fn(),
    hrefForCollection: (id: number) => `?collection=${id}`,
  },
} satisfies Meta<typeof ImageCollectionsList>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <ImageCollectionsList {...args} />,
}

export const SingleCollection: Story = {
  name: 'Single Collection',
  args: { collections: [{ id: 1, name: 'Skull comparison' }] },
}

export const ExactlyThree: Story = {
  name: 'Exactly Three (no truncation)',
  args: { collections: SAMPLE.slice(0, 3) },
}

export const Truncated: Story = {
  name: 'Truncated (more than three)',
  args: { collections: SAMPLE },
}

export const Empty: Story = {
  name: 'Empty (renders nothing)',
  args: { collections: [] },
}
