import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import StudentCollectionBadge from './StudentCollectionBadge'

const meta = {
  title: 'Components/StudentCollectionBadge',
  component: StudentCollectionBadge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "The marble-disc marker for student-curated collections: it rides the scope cluster everywhere the scope chip renders — right of the tile's visibility pill (left of its top-most scope chip on restricted), at the end of the table's Scope cell, and beside the detail header's pill slot — plus the graph legend; the canvas renderer paints the same geometry inside student-curated graph nodes.",
      },
    },
  },
  args: { size: 24 },
  argTypes: {
    size: {
      control: { type: 'number', min: 10, max: 128, step: 2 },
      description: 'Edge length in px — the artwork is authored on a 512-unit viewBox.',
    },
  },
} satisfies Meta<typeof StudentCollectionBadge>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {}

/** The sizes the badge ships at: 12px in the graph legend, 16px in the
 *  table Scope cell and compact tiles, 18px on default tiles and the
 *  detail header — plus larger reference. */
export const ShipSizes: Story = {
  name: 'Ship Sizes',
  parameters: {
    controls: { disable: true },
  },
  render: () => (
    <Stack direction="row" spacing={3} alignItems="flex-end">
      {[12, 16, 18, 32, 48].map((size) => (
        <Box key={size} sx={{ textAlign: 'center' }}>
          <StudentCollectionBadge size={size} />
          <Typography variant="caption" display="block" color="text.secondary">
            {size}px
          </Typography>
        </Box>
      ))}
    </Stack>
  ),
}
