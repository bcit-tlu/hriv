import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'

// Elevation levels in use across HRIV surfaces (cards, modals, popovers).
const LEVELS = [0, 1, 2, 4, 8, 16]

function Elevation() {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, p: 2 }}>
      {LEVELS.map((level) => (
        <Paper key={level} elevation={level} sx={{ width: 120, height: 80 }} />
      ))}
    </Box>
  )
}

const meta = {
  title: 'Foundations/Elevation',
  component: Elevation,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Elevation>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'Elevation' }
