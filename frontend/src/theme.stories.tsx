import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CssBaseline from '@mui/material/CssBaseline'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import { ColorModeContext } from './colorModeContext'
import { buildTheme, getThemePalette, type HrivThemeMode } from './theme'

interface ColorToken {
  name: string
  value: string
  description: string
}

const meta = {
  title: 'Foundations/Theme',

  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Reference for HRIV light and dark theme palettes, custom semantic tokens, opacity treatments, and common MUI component variants.',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function ModeProvider({ children, mode }: { children: ReactNode; mode: HrivThemeMode }) {
  return (
    <ColorModeContext.Provider
      value={{
        mode,
        preference: mode,
        setPreference: () => {},
        toggleMode: () => {},
      }}
    >
      <ThemeProvider theme={buildTheme(mode)}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

function tokensForMode(mode: HrivThemeMode): ColorToken[] {
  const palette = getThemePalette(mode)

  return [
    {
      name: 'primary.main',
      value: palette.primary.main,
      description: 'Main brand colour for primary actions, selected tabs, and category titles.',
    },
    {
      name: 'primary.light',
      value: palette.primary.light,
      description: 'Lighter primary shade for hover/highlight treatments.',
    },
    {
      name: 'primary.dark',
      value: palette.primary.dark,
      description: 'Darker primary shade for pressed or high-emphasis brand states.',
    },
    {
      name: 'primary.contrastText',
      value: palette.primary.contrastText,
      description: 'Text/icon colour used on primary-filled surfaces.',
    },
    {
      name: 'secondary.main',
      value: palette.secondary.main,
      description: 'Secondary brand colour, currently used for group-oriented UI.',
    },
    {
      name: 'background.default',
      value: palette.background.default,
      description: 'Default application background.',
    },
    {
      name: 'background.paper',
      value: palette.background.paper,
      description: 'Card, modal, popover, and paper surface background.',
    },
    {
      name: 'text.primary',
      value: palette.text.primary,
      description: 'Primary body text colour.',
    },
    {
      name: 'text.secondary',
      value: palette.text.secondary,
      description: 'Secondary/supporting body text colour.',
    },
    {
      name: 'surfaceVariant',
      value: palette.surfaceVariant,
      description: 'Custom surface used for People and Admin page backgrounds.',
    },
    {
      name: 'groupChip.solidBg',
      value: palette.groupChip.solidBg,
      description: 'Solid group chip background.',
    },
    {
      name: 'groupChip.solidText',
      value: palette.groupChip.solidText,
      description: 'Text/icon colour for solid group chips.',
    },
    {
      name: 'groupChip.subtleBg',
      value: palette.groupChip.subtleBg,
      description: 'Low-alpha group chip background for inherited/read-only states.',
    },
    {
      name: 'groupChip.subtleText',
      value: palette.groupChip.subtleText,
      description: 'Text colour paired with subtle group chip backgrounds.',
    },
    {
      name: 'visibility.active',
      value: palette.visibility.active,
      description: 'Neutral colour for visible/active status indicators.',
    },
    {
      name: 'visibility.inactive',
      value: palette.visibility.inactive,
      description: 'Accessible inactive/hidden status colour with built-in alpha.',
    },
    {
      name: 'visibility.inactiveChipBg',
      value: palette.visibility.inactiveChipBg,
      description: 'Filled chip background for inactive/hidden visibility states.',
    },
  ]
}

function readableTextColor(background: string): string {
  if (background.startsWith('rgba')) return 'text.primary'

  const hex = background.replace('#', '')
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.58 ? '#1E1E1E' : '#FFFFFF'
}

function ColorSwatch({ token }: { token: ColorToken }) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          alignItems: 'flex-end',
          bgcolor: token.value,
          color: readableTextColor(token.value),
          display: 'flex',
          height: 96,
          p: 1.5,
        }}
      >
        <Typography fontFamily="monospace" variant="caption">
          {token.value}
        </Typography>
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Typography fontFamily="monospace" variant="subtitle2">
          {token.name}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {token.description}
        </Typography>
      </Box>
    </Paper>
  )
}

function PaletteGrid({ mode }: { mode: HrivThemeMode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      {tokensForMode(mode).map((token) => (
        <ColorSwatch key={token.name} token={token} />
      ))}
    </Box>
  )
}

function VariantSamples() {
  return (
    <Stack spacing={3}>
      <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1.5}>
        <Button variant="contained">Primary contained</Button>
        <Button variant="outlined">Primary outlined</Button>
        <Button color="secondary" variant="contained">
          Secondary contained
        </Button>
        <Button color="secondary" variant="outlined">
          Secondary outlined
        </Button>
      </Stack>

      <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1}>
        <Chip color="primary" label="Program chip" />
        <Chip color="secondary" label="Group chip" />
        <Chip label="Inherited program" sx={{ opacity: 0.6 }} />
        <Chip label="Hidden" sx={{ bgcolor: 'text.secondary', color: 'background.paper' }} />
      </Stack>

      <Stack spacing={1.5}>
        <Alert severity="info" variant="filled">
          Filled info alert
        </Alert>
        <Alert severity="warning" variant="outlined">
          Outlined warning alert
        </Alert>
        <Alert severity="success" variant="standard">
          Standard success alert
        </Alert>
      </Stack>
    </Stack>
  )
}

function ThemePage({ mode }: { mode: HrivThemeMode }) {
  const title = mode === 'dark' ? 'Dark Theme' : 'Light Theme'

  return (
    <ModeProvider mode={mode}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 4 }}>
        <Stack spacing={4}>
          <Box>
            <Typography variant="h4">{title}</Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 760 }} variant="body1">
              HRIV uses one semantic palette per colour mode. These tokens feed MUI theme slots and
              custom HRIV variants so components can stay consistent across light and dark
              appearances.
            </Typography>
          </Box>

          <section>
            <Typography gutterBottom variant="h5">
              Palette tokens
            </Typography>
            <PaletteGrid mode={mode} />
          </section>

          <Divider />

          <section>
            <Typography gutterBottom variant="h5">
              Component variants
            </Typography>
            <Paper sx={{ p: 3 }} variant="outlined">
              <VariantSamples />
            </Paper>
          </section>
        </Stack>
      </Box>
    </ModeProvider>
  )
}

export const LightTheme: Story = {
  name: 'Light Theme',
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <ThemePage mode="light" />,
}

export const DarkTheme: Story = {
  name: 'Dark Theme',
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <ThemePage mode="dark" />,
}
