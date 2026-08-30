import type { Meta, StoryObj } from '@storybook/react-vite'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

type LinkMode = 'anchor' | 'button'
type LinkVariant = 'body1' | 'body2' | 'caption' | 'inherit'
type LinkColor = 'primary' | 'secondary' | 'text.primary' | 'text.secondary' | 'inherit'
type LinkUnderline = 'none' | 'hover' | 'always'

interface LinkStoryArgs {
  label: string
  mode: LinkMode
  variant: LinkVariant
  color: LinkColor
  underline: LinkUnderline
  external: boolean
}

function LinkExample(args: LinkStoryArgs) {
  if (args.mode === 'button') {
    return (
      <Link
        color={args.color}
        component="button"
        onClick={() => undefined}
        sx={{ cursor: 'pointer' }}
        underline={args.underline}
        variant={args.variant}
      >
        {args.label}
      </Link>
    )
  }

  return (
    <Link
      color={args.color}
      href={args.external ? 'https://github.com/bcit-tlu/hriv' : '#'}
      rel={args.external ? 'noopener noreferrer' : undefined}
      target={args.external ? '_blank' : undefined}
      underline={args.underline}
      variant={args.variant}
    >
      {args.label}
    </Link>
  )
}

const meta = {
  title: 'Components/Link',
  component: LinkExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reference for HRIV link treatments built on MUI Link, including footer links, button-style navigation links, breadcrumbs, and status/log links.',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
    mode: { control: 'inline-radio', options: ['anchor', 'button'] },
    variant: { control: 'select', options: ['body1', 'body2', 'caption', 'inherit'] },
    color: {
      control: 'select',
      options: ['primary', 'secondary', 'text.primary', 'text.secondary', 'inherit'],
    },
    underline: { control: 'inline-radio', options: ['none', 'hover', 'always'] },
    external: { control: 'boolean' },
  },
  args: {
    label: 'High Resolution Image Viewer',
    mode: 'anchor',
    variant: 'body2',
    color: 'primary',
    underline: 'hover',
    external: false,
  },
} satisfies Meta<typeof LinkExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <LinkExample {...args} />,
}

export const FooterLinks: Story = {
  name: 'Footer Links',
  parameters: { controls: { disable: true } },
  render: () => (
    <Paper sx={{ p: 2, width: 760, maxWidth: '90vw' }} variant="outlined">
      <Typography color="text.secondary" variant="caption">
        <Link
          color="text.secondary"
          href="https://github.com/bcit-tlu/hriv"
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
        >
          High Resolution Image Viewer
        </Link>
        <span style={{ display: 'inline-block', width: '3ch' }} />
        <strong>Frontend:</strong>{' '}
        <Link
          color="text.secondary"
          href="https://github.com/bcit-tlu/hriv/releases"
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
        >
          0.43.1
        </Link>
        <span style={{ display: 'inline-block', width: '3ch' }} />
        <Link
          color="text.secondary"
          component="button"
          onClick={() => undefined}
          sx={{ cursor: 'pointer' }}
          underline="hover"
          variant="caption"
        >
          Send Feedback
        </Link>
      </Typography>
    </Paper>
  ),
}

export const ButtonLinks: Story = {
  name: 'Button Links',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack alignItems="flex-start" spacing={1.5}>
      <Link component="button" onClick={() => undefined} underline="hover" variant="body2">
        Sign in with a guest account
      </Link>
      <Link component="button" onClick={() => undefined} underline="always" variant="body2">
        View task log
      </Link>
      <Link
        color="inherit"
        component="button"
        onClick={() => undefined}
        underline="hover"
        variant="body2"
      >
        Architecture
      </Link>
    </Stack>
  ),
}

export const BreadcrumbLinks: Story = {
  name: 'Breadcrumb Links',
  parameters: { controls: { disable: true } },
  render: () => (
    <Typography color="text.secondary" variant="body2">
      <Link
        color="inherit"
        component="button"
        onClick={() => undefined}
        underline="hover"
        variant="body2"
      >
        Home
      </Link>{' '}
      /{' '}
      <Link
        color="inherit"
        component="button"
        onClick={() => undefined}
        underline="hover"
        variant="body2"
      >
        Architecture
      </Link>{' '}
      /{' '}
      <Typography component="span" color="text.primary" variant="body2">
        Italian
      </Typography>
    </Typography>
  ),
}
