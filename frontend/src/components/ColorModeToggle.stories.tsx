import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { ColorModeContext, type ColorMode, type ColorModePreference } from '../colorModeContext'
import ColorModeToggle from './ColorModeToggle'

interface ColorModeToggleStoryArgs {
  mode: ColorMode
  preference: ColorModePreference
  placement: 'app bar' | 'login screen'
}

function ColorModeToggleExample(args: ColorModeToggleStoryArgs) {
  return (
    <ColorModeContext.Provider
      value={{
        mode: args.mode,
        preference: args.preference,
        setPreference: () => {},
        toggleMode: () => {},
      }}
    >
      <Box
        sx={{
          bgcolor: args.placement === 'app bar' ? 'primary.main' : 'background.paper',
          color: args.placement === 'app bar' ? 'primary.contrastText' : 'text.primary',
          p: 2,
          borderRadius: 1,
        }}
      >
        <ColorModeToggle
          iconButtonSx={
            args.placement === 'login screen' ? { color: 'text.secondary' } : { color: 'inherit' }
          }
        />
      </Box>
    </ColorModeContext.Provider>
  )
}

const meta = {
  title: 'Components/ColorModeToggle',
  component: ColorModeToggleExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Three-way theme picker icon button that cycles Light → Dark → Auto and adapts its colour to app-bar or login-screen placement.',
      },
    },
  },
  argTypes: {
    mode: { control: 'inline-radio', options: ['light', 'dark'] },
    preference: { control: 'inline-radio', options: ['light', 'dark', 'auto'] },
    placement: { control: 'inline-radio', options: ['app bar', 'login screen'] },
  },
  args: {
    mode: 'light',
    preference: 'auto',
    placement: 'login screen',
  },
} satisfies Meta<typeof ColorModeToggleExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <ColorModeToggleExample {...args} />,
}

export const LightPreference: Story = {
  name: 'Light Preference',
  args: { preference: 'light', mode: 'light' },
  render: (args) => <ColorModeToggleExample {...args} />,
}

export const DarkPreference: Story = {
  name: 'Dark Preference',
  args: { preference: 'dark', mode: 'dark' },
  render: (args) => <ColorModeToggleExample {...args} />,
}

export const AutoPreference: Story = {
  name: 'Auto Preference',
  args: { preference: 'auto', mode: 'light' },
  render: (args) => <ColorModeToggleExample {...args} />,
}

export const PlacementVariants: Story = {
  name: 'Placement Variants',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack direction="row" spacing={3}>
      <Stack alignItems="center" spacing={1}>
        <Typography color="text.secondary" variant="caption">
          Login screen
        </Typography>
        <ColorModeToggleExample mode="light" preference="auto" placement="login screen" />
      </Stack>
      <Stack alignItems="center" spacing={1}>
        <Typography color="text.secondary" variant="caption">
          App bar
        </Typography>
        <ColorModeToggleExample mode="dark" preference="dark" placement="app bar" />
      </Stack>
    </Stack>
  ),
}
