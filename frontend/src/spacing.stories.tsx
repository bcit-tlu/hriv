import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

// One row of the spacing scale: a label (unit → px) and a bar sized to that step.
function SpacingRow({ step, px }: { step: number; px: string }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Typography variant="caption" sx={{ width: 96, fontFamily: 'monospace' }}>
        {step} → {px}
      </Typography>
      <Box sx={{ height: 16, width: px, bgcolor: 'primary.main', borderRadius: 0.5 }} />
    </Stack>
  )
}

// One row of the breakpoint scale: the key and its min-width.
function BreakpointRow({ name, px }: { name: string; px: string }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Typography variant="caption" sx={{ width: 96, fontFamily: 'monospace' }}>
        {name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        min-width {px}
      </Typography>
    </Stack>
  )
}

function Spacing() {
  const theme = useTheme()
  // MUI spacing units — theme.spacing(n) returns an 8px-based px string.
  const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8]

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="overline">Spacing scale — theme.spacing(n)</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {steps.map((step) => (
            <SpacingRow key={step} step={step} px={theme.spacing(step)} />
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="overline">Breakpoints — theme.breakpoints</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {theme.breakpoints.keys.map((name) => (
            <BreakpointRow key={name} name={name} px={`${theme.breakpoints.values[name]}px`} />
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}

const meta = {
  title: 'Foundations/Spacing',
  component: Spacing,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The 8px spacing scale and responsive breakpoints used across HRIV. Each spacing step ' +
          'maps to theme.spacing(n) — so a value of 2 resolves to 16px. Prefer these tokens for ' +
          'margins, padding, and gaps instead of hardcoded pixels. Breakpoints drive responsive ' +
          'layout via theme.breakpoints.',
      },
    },
  },
} satisfies Meta<typeof Spacing>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'Scale' }
