import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import FooterBar from './FooterBar'

interface FooterBarStoryArgs {
  canManageUsers: boolean
  frontendVersion: string
  backendVersion: string
  backupVersion: string
  showReportIssue: boolean
}

function FooterBarExample(args: FooterBarStoryArgs) {
  return (
    <Box sx={{ width: 960, maxWidth: '90vw' }}>
      <FooterBar
        canManageUsers={args.canManageUsers}
        frontendVersion={args.frontendVersion || undefined}
        backendVersion={args.backendVersion || undefined}
        backupVersion={args.backupVersion || undefined}
        onReportIssue={args.showReportIssue ? () => undefined : undefined}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/FooterBar',
  component: FooterBarExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Application footer showing the repository link, optional admin-visible component versions, and optional report-issue action.',
      },
    },
  },
  argTypes: {
    canManageUsers: { control: 'boolean' },
    frontendVersion: { control: 'text' },
    backendVersion: { control: 'text' },
    backupVersion: { control: 'text' },
    showReportIssue: { control: 'boolean' },
  },
  args: {
    canManageUsers: false,
    frontendVersion: 'dev',
    backendVersion: '',
    backupVersion: '',
    showReportIssue: true,
  },
} satisfies Meta<typeof FooterBarExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <FooterBarExample {...args} />,
}

export const StudentFooter: Story = {
  name: 'Student Footer',
  args: {
    canManageUsers: false,
    showReportIssue: true,
  },
  render: (args) => <FooterBarExample {...args} />,
}

export const AdminFooterWithVersions: Story = {
  name: 'Admin Footer With Versions',
  args: {
    canManageUsers: true,
    frontendVersion: '0.43.1',
    backendVersion: '0.44.0',
    backupVersion: '0.8.0',
    showReportIssue: true,
  },
  render: (args) => <FooterBarExample {...args} />,
}

export const AdminFooterLoadingVersions: Story = {
  name: 'Admin Footer Loading Versions',
  args: {
    canManageUsers: true,
    frontendVersion: 'dev',
    backendVersion: '',
    backupVersion: '',
    showReportIssue: false,
  },
  render: (args) => <FooterBarExample {...args} />,
}
