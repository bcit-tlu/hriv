import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import LoginSplashImage from './LoginSplashImage'

interface LoginSplashImageStoryArgs {
  frame: 'desktop split' | 'image only'
  minHeight: number
}

function LoginSplashImageExample({ frame, minHeight }: LoginSplashImageStoryArgs) {
  if (frame === 'image only') {
    return (
      <Box sx={{ display: 'flex', width: 640, maxWidth: '90vw', minHeight }}>
        <LoginSplashImage />
      </Box>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        display: 'flex',
        overflow: 'hidden',
        width: 960,
        maxWidth: '90vw',
        minHeight,
      }}
    >
      <Stack justifyContent="center" spacing={1} sx={{ flex: '1 1 50%', p: 4 }}>
        <Typography variant="h5">Login form column</Typography>
        <Typography color="text.secondary" variant="body2">
          The splash image occupies the right half of the desktop login layout and is hidden below
          the medium breakpoint.
        </Typography>
      </Stack>
      <LoginSplashImage />
    </Paper>
  )
}

const meta = {
  title: 'Components/LoginSplashImage',
  component: LoginSplashImageExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Responsive decorative splash image used as the right-hand panel on the desktop login screen.',
      },
    },
  },
  argTypes: {
    frame: {
      control: 'inline-radio',
      options: ['desktop split', 'image only'],
      description: 'Story frame used to preview the image in context or by itself.',
    },
    minHeight: {
      control: { type: 'number', min: 240, max: 720, step: 40 },
      description: 'Preview height for the story frame.',
    },
  },
  args: {
    frame: 'desktop split',
    minHeight: 480,
  },
} satisfies Meta<typeof LoginSplashImageExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <LoginSplashImageExample {...args} />,
}

export const DesktopSplit: Story = {
  name: 'Desktop Split',
  args: {
    frame: 'desktop split',
  },
  render: (args) => <LoginSplashImageExample {...args} />,
}

export const ImageOnly: Story = {
  name: 'Image Only',
  args: {
    frame: 'image only',
  },
  render: (args) => <LoginSplashImageExample {...args} />,
}
