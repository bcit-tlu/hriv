import type { Meta, StoryObj } from '@storybook/react-vite'
import AutoModeIcon from '@mui/icons-material/BrightnessAuto'
import SaveIcon from '@mui/icons-material/Save'
import SearchIcon from '@mui/icons-material/Search'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Stack from '@mui/material/Stack'

type ButtonVariant = 'contained' | 'outlined' | 'text'
type ButtonColor = 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning' | 'inherit'
type ButtonSize = 'small' | 'medium' | 'large'
type ButtonIcon = 'none' | 'save' | 'search' | 'loading'

interface ButtonStoryArgs {
  label: string
  variant: ButtonVariant
  color: ButtonColor
  size: ButtonSize
  disabled: boolean
  fullWidth: boolean
  icon: ButtonIcon
}

function iconFor(icon: ButtonIcon) {
  if (icon === 'save') return <SaveIcon />
  if (icon === 'search') return <SearchIcon />
  if (icon === 'loading') return <CircularProgress color="inherit" size={18} />
  return undefined
}

function ButtonExample(args: ButtonStoryArgs) {
  return (
    <Button
      color={args.color}
      disabled={args.disabled || args.icon === 'loading'}
      fullWidth={args.fullWidth}
      size={args.size}
      startIcon={iconFor(args.icon)}
      variant={args.variant}
    >
      {args.icon === 'loading' ? 'Working…' : args.label}
    </Button>
  )
}

const meta = {
  title: 'Components/Button',
  component: ButtonExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reference for HRIV button usage built on MUI Button variants, colours, sizes, icons, and loading affordances.',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
    variant: { control: 'inline-radio', options: ['contained', 'outlined', 'text'] },
    color: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'error', 'info', 'warning', 'inherit'],
    },
    size: { control: 'inline-radio', options: ['small', 'medium', 'large'] },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    icon: { control: 'select', options: ['none', 'save', 'search', 'loading'] },
  },
  args: {
    label: 'Button',
    variant: 'contained',
    color: 'primary',
    size: 'medium',
    disabled: false,
    fullWidth: false,
    icon: 'none',
  },
} satisfies Meta<typeof ButtonExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <ButtonExample {...args} />,
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack alignItems="center" direction="row" flexWrap="wrap" gap={2}>
      <Button variant="contained">Contained</Button>
      <Button variant="outlined">Outlined</Button>
      <Button variant="text">Text</Button>
      <Button color="secondary" variant="contained">
        Secondary
      </Button>
      <Button color="error" variant="outlined">
        Destructive
      </Button>
    </Stack>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack alignItems="center" direction="row" gap={2}>
      <Button size="small" variant="contained">
        Small
      </Button>
      <Button size="medium" variant="contained">
        Medium
      </Button>
      <Button size="large" variant="contained">
        Large
      </Button>
    </Stack>
  ),
}

export const DialogActions: Story = {
  name: 'Dialog Actions',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack alignItems="center" direction="row" gap={2}>
      <Button>Cancel</Button>
      <Button variant="contained">Save</Button>
      <Button color="warning" variant="contained">
        Restore
      </Button>
      <Button color="error" variant="outlined">
        Delete
      </Button>
    </Stack>
  ),
}

export const ThemePickerButton: Story = {
  name: 'Theme Picker Button',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack alignItems="center" direction="row" gap={2}>
      <Tooltip title="Theme: Auto – follows system (light) (click for Light)">
        <IconButton aria-label="Toggle theme" sx={{ color: 'text.secondary' }}>
          <AutoModeIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Theme picker in app bar">
        <IconButton
          aria-label="Toggle theme"
          sx={{ color: 'primary.contrastText', bgcolor: 'primary.main' }}
        >
          <AutoModeIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  ),
}

export const LoginActions: Story = {
  name: 'Login Actions',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack direction="row" justifyContent="space-between" sx={{ width: 400 }}>
      <Button
        sx={{ px: 0, fontWeight: 600, letterSpacing: 1, color: 'text.disabled' }}
        variant="text"
      >
        Forgot Password?
      </Button>
      <Button sx={{ fontWeight: 600, letterSpacing: 1 }} variant="text">
        LOGIN
      </Button>
    </Stack>
  ),
}
