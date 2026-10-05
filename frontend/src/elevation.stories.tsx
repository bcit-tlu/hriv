import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

// Elevation levels currently in use across HRIV surfaces — via both `elevation`
// props and `boxShadow` tokens. MUI's Paper supports 0–24; these are the ones
// the app actually uses today.
//   0 — announcement banner   1 — app bar   2 — cards / image / category tiles
//   3 — collection viewers / dialogs   4 — filter popover   8 — dragged category tile
const LEVELS = [0, 1, 2, 3, 4, 8]

function Elevation() {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, p: 2 }}>
      {LEVELS.map((level) => (
        <Paper
          key={level}
          elevation={level}
          sx={{ width: 120, height: 80, display: 'grid', placeItems: 'center' }}
        >
          <Typography variant="caption">elevation {level}</Typography>
        </Paper>
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
