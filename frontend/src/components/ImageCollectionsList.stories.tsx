import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import ImageCollectionsList from './ImageCollectionsList'

const meta = {
  title: 'Components/ImageCollectionsList',
  component: ImageCollectionsList,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Read-only "Collections" row for the image viewer metadata area (#1586). Lists the collections an image belongs to, truncating to three names with an inline “… and N more” expander when there are more.',
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
    names: {
      control: 'object',
      description:
        'Collection names the image belongs to (already visibility-filtered and ordered).',
    },
    limit: {
      control: { type: 'number', min: 1, max: 10, step: 1 },
      description: 'How many names to show before the "more" affordance.',
    },
  },
  args: {
    names: [
      'Skull comparison',
      'Teaching set A',
      'Midterm review',
      'Lateral views',
      'Archive 2026',
    ],
    limit: 3,
  },
} satisfies Meta<typeof ImageCollectionsList>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <ImageCollectionsList {...args} />,
}

export const SingleCollection: Story = {
  name: 'Single Collection',
  args: { names: ['Skull comparison'] },
}

export const ExactlyThree: Story = {
  name: 'Exactly Three (no truncation)',
  args: { names: ['Skull comparison', 'Teaching set A', 'Midterm review'] },
}

export const Truncated: Story = {
  name: 'Truncated (more than three)',
  args: {
    names: [
      'Skull comparison',
      'Teaching set A',
      'Midterm review',
      'Lateral views',
      'Archive 2026',
    ],
  },
}

export const Empty: Story = {
  name: 'Empty (renders nothing)',
  args: { names: [] },
}
