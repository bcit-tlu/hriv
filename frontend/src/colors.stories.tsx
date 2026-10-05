import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <Stack spacing={1} sx={{ width: 120 }}>
      <Box
        sx={{
          height: 56,
          bgcolor: color,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
        }}
      />
      <Typography variant="caption">{name}</Typography>
      <Typography variant="caption">{color}</Typography>
    </Stack>
  )
}

function Palette() {
  const theme = useTheme()
  const channels = ['primary', 'secondary', 'error', 'warning', 'info', 'success'] as const
  return (
    <Stack spacing={3}>
      {channels.map((channel) => {
        const c = theme.palette[channel]
        return (
          <Box key={channel}>
            <Typography variant="overline">{channel}</Typography>
            <Stack direction="row" spacing={3}>
              <Swatch name="main" color={c.main} />
              <Swatch name="light" color={c.light} />
              <Swatch name="dark" color={c.dark} />
              <Swatch name="contrastText" color={c.contrastText} />
            </Stack>
          </Box>
        )
      })}

      <Stack spacing={3} direction="row">
        <Swatch name="text" color={theme.palette.text.primary} />
        <Swatch name="background" color={theme.palette.background.default} />
        <Swatch name="divider" color={theme.palette.divider} />
      </Stack>
    </Stack>
  )
}

const meta = {
  title: 'Foundations/Colors',
  component: Palette,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Palette>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'Palette' }
