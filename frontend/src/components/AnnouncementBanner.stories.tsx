import { useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import AnnouncementBanner from './AnnouncementBanner'

const defaultMessage =
  'Welcome. A more robust announcement feature would surface the communication history.'

type AnnouncementBannerStoryProps = ComponentProps<typeof AnnouncementBanner>

const meta = {
  title: 'Components/AnnouncementBanner',
  component: AnnouncementBanner,

  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Displays the current HRIV announcement in either the authenticated app shell or the login screen.',
      },
    },
  },
  argTypes: {
    message: {
      control: 'text',
      description: 'Announcement text. An empty value renders nothing.',
    },
    variant: {
      control: 'inline-radio',
      options: ['app', 'login'],
      description: 'HRIV placement/layout treatment for where the banner appears.',
    },
    alertVariant: {
      control: 'inline-radio',
      options: ['filled', 'outlined', 'standard'],
      description: 'MUI Alert variant.',
    },
    severity: {
      control: 'select',
      options: ['error', 'info', 'success', 'warning'],
      description: 'MUI Alert severity.',
    },
    color: {
      control: 'select',
      options: ['error', 'info', 'success', 'warning'],
      description:
        'Optional MUI Alert color override. Leave unset for the default severity colour.',
    },
    onDismiss: {
      table: {
        disable: true,
      },
    },
  },
  args: {
    message: defaultMessage,
    variant: 'app',
    alertVariant: 'filled',
    color: 'info',
    severity: 'info',
  },
} satisfies Meta<typeof AnnouncementBanner>

export default meta

type Story = StoryObj<typeof meta>

function StoryFrame({ children, width = 960 }: { children: ReactNode; width?: number }) {
  return <Box sx={{ width, maxWidth: '90vw' }}>{children}</Box>
}

function DismissibleExample(args: AnnouncementBannerStoryProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          Announcement dismissed for this session.
        </Typography>
      </Paper>
    )
  }

  return <AnnouncementBanner {...args} onDismiss={() => setVisible(false)} />
}

export const Basic: Story = {
  parameters: {
    // Known theme-palette contrast debt (alert message) — see #1345.
    a11y: { test: 'todo' },
  },
  render: (args) => (
    <StoryFrame>
      <AnnouncementBanner {...args} />
    </StoryFrame>
  ),
}

export const WithDismissAction: Story = {
  name: 'With Dismiss Action',
  args: {
    message: defaultMessage,
    variant: 'app',
  },
  render: (args) => (
    <StoryFrame>
      <DismissibleExample {...args} />
    </StoryFrame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    await expect(canvas.getByText(defaultMessage)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close announcement' }))
    await expect(canvas.getByText('Announcement dismissed for this session.')).toBeVisible()
    await expect(canvas.queryByText(defaultMessage)).toBeNull()
  },
}

export const LoginScreen: Story = {
  name: 'Login Screen',
  parameters: {
    // Known theme-palette contrast debt (alert message) — see #1345.
    a11y: { test: 'todo' },
  },
  args: {
    message: defaultMessage,
    variant: 'login',
  },
  render: (args) => (
    <StoryFrame width={448}>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          bgcolor: 'background.default',
        }}
      >
        <AnnouncementBanner {...args} />
        <Typography variant="h5">HRIV Login</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
          The login state uses the constrained column shown before the credentials form.
        </Typography>
      </Paper>
    </StoryFrame>
  ),
}

export const EmptyMessage: Story = {
  name: 'Empty Message',
  args: {
    message: '',
    variant: 'app',
  },
  render: (args) => (
    <StoryFrame width={448}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <AnnouncementBanner {...args} />
        <Typography color="text.secondary" variant="body2">
          No banner is rendered when the current announcement message is empty.
        </Typography>
      </Paper>
    </StoryFrame>
  ),
}

export const WarningWithMore: Story = {
  name: 'Warning With More',
  args: {
    title: 'Planned maintenance',
    message: 'HRIV is offline Saturday 06:00-08:00 PT while the tile store is migrated.',
    severity: 'warning',
    variant: 'app',
    alertVariant: 'standard',
    moreCount: 2,
    onMore: () => {},
    onDismiss: () => {},
  },
  render: (args) => (
    <StoryFrame>
      <AnnouncementBanner {...args} />
    </StoryFrame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Planned maintenance')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '+2 more' })).toBeVisible()
  },
}

export const LongBodyClamped: Story = {
  name: 'Long Body Clamped',
  args: {
    title: 'Welcome to the new term',
    message:
      'Lab sessions start Monday. Please review the histology slide set before your first session, bring your student card for lab access, and remember that food and drink are not permitted in the microscopy room.\n\nSee the Announcements page for the full schedule.',
    severity: 'info',
    variant: 'app',
    alertVariant: 'standard',
    onDismiss: () => {},
  },
  render: (args) => (
    <StoryFrame width={448}>
      <AnnouncementBanner {...args} />
    </StoryFrame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'More' }))
    await expect(canvas.getByRole('button', { name: 'Less' })).toBeVisible()
  },
}

export const KindIcon: Story = {
  name: 'Kind Icon',
  args: {
    title: 'Open house this Friday',
    message: 'Drop by the lab between 13:00 and 15:00 — bring your questions and a friend.',
    kind: 'celebration',
    variant: 'app',
    onDismiss: () => {},
  },
  render: (args) => (
    <StoryFrame>
      <AnnouncementBanner {...args} />
    </StoryFrame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Celebration' })).toBeVisible()
  },
}
