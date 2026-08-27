import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { TypographyProps } from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import { ColorModeContext } from './colorModeContext'
import { buildTheme, type HrivThemeMode } from './theme'

type TypographyVariant = NonNullable<TypographyProps['variant']>
type TypographyColor = NonNullable<TypographyProps['color']>
type TypographyAlign = NonNullable<TypographyProps['align']>

interface TypographyStoryArgs {
  text: string
  variant: TypographyVariant
  color: TypographyColor
  align: TypographyAlign
  fontWeight: 'default' | 'regular' | 'medium' | 'bold'
  gutterBottom: boolean
  noWrap: boolean
  paragraph: boolean
}

const variantOptions: TypographyVariant[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'subtitle1',
  'subtitle2',
  'body1',
  'body2',
  'caption',
  'overline',
]

const colorOptions: TypographyColor[] = [
  'initial',
  'inherit',
  'primary',
  'secondary',
  'text.primary',
  'text.secondary',
  'error',
  'warning.main',
  'success.main',
]

const alignOptions: TypographyAlign[] = ['inherit', 'left', 'center', 'right', 'justify']

const fontWeightValues: Record<TypographyStoryArgs['fontWeight'], TypographyProps['fontWeight']> = {
  default: undefined,
  regular: 400,
  medium: 500,
  bold: 700,
}

const sampleSentence = 'High Resolution Image Viewer preserves visual detail for teaching.'

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

function TypographySample(args: TypographyStoryArgs) {
  return (
    <Box sx={{ width: 720, maxWidth: '90vw' }}>
      <Typography
        align={args.align}
        color={args.color}
        fontWeight={fontWeightValues[args.fontWeight]}
        gutterBottom={args.gutterBottom}
        noWrap={args.noWrap}
        paragraph={args.paragraph}
        variant={args.variant}
      >
        {args.text}
      </Typography>
    </Box>
  )
}

function VariantRow({
  description,
  label,
  variant,
}: {
  description: string
  label: string
  variant: TypographyVariant
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: '160px minmax(0, 1fr)' },
        py: 1.5,
      }}
    >
      <Box>
        <Typography fontFamily="monospace" variant="body2">
          {label}
        </Typography>
        <Typography color="text.secondary" variant="caption">
          {description}
        </Typography>
      </Box>
      <Typography variant={variant}>{sampleSentence}</Typography>
    </Box>
  )
}

function TypographyScaleContent() {
  return (
    <Paper sx={{ width: 960, maxWidth: '90vw', p: 3 }} variant="outlined">
      <Stack divider={<Divider flexItem />} spacing={0}>
        <VariantRow description="Large page or foundation headings." label="h4" variant="h4" />
        <VariantRow
          description="Dialog, page section, and login headings."
          label="h5"
          variant="h5"
        />
        <VariantRow
          description="Card titles, tile labels, and section headings."
          label="h6"
          variant="h6"
        />
        <VariantRow
          description="Rare supporting heading treatment."
          label="subtitle1"
          variant="subtitle1"
        />
        <VariantRow
          description="Compact metadata and table-adjacent headings."
          label="subtitle2"
          variant="subtitle2"
        />
        <VariantRow
          description="Default body copy and empty-state messages."
          label="body1"
          variant="body1"
        />
        <VariantRow
          description="Dense metadata, breadcrumbs, helper text, and tile counts."
          label="body2"
          variant="body2"
        />
        <VariantRow
          description="Footer, timestamps, status details, and small labels."
          label="caption"
          variant="caption"
        />
        <VariantRow
          description="Reference labels inside Storybook docs and examples."
          label="overline"
          variant="overline"
        />
      </Stack>
    </Paper>
  )
}

function UsageExamplesContent() {
  return (
    <Stack spacing={3} sx={{ width: 960, maxWidth: '90vw' }}>
      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography gutterBottom variant="h5">
          Manage Images
        </Typography>
        <Typography color="text.secondary" variant="body1">
          Use `h5` for modal and major page-section headings, paired with `body1` for short
          explanatory copy.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography color="primary" gutterBottom variant="h6">
          Architecture
        </Typography>
        <Typography color="text.secondary" variant="body2">
          3 sub-categories · 12 images
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Stack spacing={1}>
          <Typography color="text.secondary" variant="caption">
            Last updated
          </Typography>
          <Typography variant="body2">August 27, 2026, 3:15 PM</Typography>
          <Typography color="text.secondary" variant="body2">
            Use `caption` for labels and `body2` for compact metadata values.
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  )
}

function ThemedTypographyScale({ mode }: { mode: HrivThemeMode }) {
  return (
    <ModeProvider mode={mode}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">
              {mode === 'dark' ? 'Dark Theme Typography' : 'Light Theme Typography'}
            </Typography>
            <Typography color="text.secondary" variant="body1">
              Typography uses the same Roboto stack in both modes while text colours shift through
              HRIV's theme palette.
            </Typography>
          </Box>
          <TypographyScaleContent />
        </Stack>
      </Box>
    </ModeProvider>
  )
}

const meta = {
  title: 'Foundations/Typography',
  component: TypographySample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reference for HRIV typography guidance, MUI Typography variants, text colours, and common usage patterns.',
      },
    },
  },
  argTypes: {
    text: {
      control: 'text',
      description: 'Text rendered by the Typography component.',
    },
    variant: {
      control: 'select',
      options: variantOptions,
      description: 'MUI Typography variant.',
    },
    color: {
      control: 'select',
      options: colorOptions,
      description: 'MUI Typography colour token or theme colour.',
    },
    align: {
      control: 'inline-radio',
      options: alignOptions,
      description: 'Text alignment.',
    },
    fontWeight: {
      control: 'inline-radio',
      options: ['default', 'regular', 'medium', 'bold'],
      description: 'Common font-weight override used in HRIV UI.',
    },
    gutterBottom: {
      control: 'boolean',
      description: 'Adds bottom margin for headings and short labels.',
    },
    noWrap: {
      control: 'boolean',
      description: 'Prevents wrapping and applies ellipsis for constrained UI.',
    },
    paragraph: {
      control: 'boolean',
      description: 'Renders paragraph spacing for body copy.',
    },
  },
  args: {
    text: sampleSentence,
    variant: 'body1',
    color: 'text.primary',
    align: 'inherit',
    fontWeight: 'default',
    gutterBottom: false,
    noWrap: false,
    paragraph: false,
  },
} satisfies Meta<typeof TypographySample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <TypographySample {...args} />,
}

export const Scale: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <TypographyScaleContent />,
}

export const UsageExamples: Story = {
  name: 'Usage Examples',
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <UsageExamplesContent />,
}

export const LightTheme: Story = {
  name: 'Light Theme',
  parameters: {
    controls: {
      disable: true,
    },
    layout: 'fullscreen',
  },
  render: () => <ThemedTypographyScale mode="light" />,
}

export const DarkTheme: Story = {
  name: 'Dark Theme',
  parameters: {
    controls: {
      disable: true,
    },
    layout: 'fullscreen',
  },
  render: () => <ThemedTypographyScale mode="dark" />,
}
