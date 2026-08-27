import type { Meta, StoryObj } from '@storybook/react-vite'
import Visibility from '@mui/icons-material/Visibility'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'

type FieldVariant = 'standard' | 'outlined' | 'filled'
type FieldSize = 'small' | 'medium'
type FieldType = 'text' | 'email' | 'password'
type FieldColor = 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'

interface FieldStoryArgs {
  label: string
  placeholder: string
  helperText: string
  value: string
  variant: FieldVariant
  size: FieldSize
  type: FieldType
  color: FieldColor
  required: boolean
  disabled: boolean
  error: boolean
  fullWidth: boolean
  passwordAdornment: boolean
}

function FieldExample(args: FieldStoryArgs) {
  return (
    <TextField
      color={args.color}
      disabled={args.disabled}
      error={args.error}
      fullWidth={args.fullWidth}
      helperText={args.helperText || undefined}
      label={args.label}
      placeholder={args.placeholder}
      required={args.required}
      size={args.size}
      slotProps={{
        input: {
          endAdornment:
            args.passwordAdornment || args.type === 'password' ? (
              <InputAdornment position="end">
                <IconButton aria-label="toggle password visibility" edge="end" size="small">
                  <Visibility />
                </IconButton>
              </InputAdornment>
            ) : undefined,
        },
      }}
      type={args.type}
      value={args.value}
      variant={args.variant}
    />
  )
}

const meta = {
  title: 'Components/Field',
  component: FieldExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reference for HRIV form fields built on MUI TextField variants, sizes, states, helper text, and adornments.',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    helperText: { control: 'text' },
    value: { control: 'text' },
    variant: { control: 'inline-radio', options: ['standard', 'outlined', 'filled'] },
    size: { control: 'inline-radio', options: ['small', 'medium'] },
    type: { control: 'inline-radio', options: ['text', 'email', 'password'] },
    color: {
      control: 'select',
      options: ['primary', 'secondary', 'error', 'info', 'success', 'warning'],
    },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    passwordAdornment: { control: 'boolean' },
  },
  args: {
    label: 'Username',
    placeholder: 'username@example.ca',
    helperText: '',
    value: '',
    variant: 'standard',
    size: 'medium',
    type: 'email',
    color: 'primary',
    required: true,
    disabled: false,
    error: false,
    fullWidth: true,
    passwordAdornment: false,
  },
} satisfies Meta<typeof FieldExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => (
    <Stack sx={{ width: 400 }}>
      <FieldExample {...args} />
    </Stack>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <TextField label="Standard" placeholder="Standard field" variant="standard" />
      <TextField label="Outlined" placeholder="Outlined field" variant="outlined" />
      <TextField label="Filled" placeholder="Filled field" variant="filled" />
    </Stack>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <TextField helperText="Required field" label="Required" required variant="standard" />
      <TextField
        error
        helperText="Please enter a valid email address"
        label="Error"
        variant="standard"
      />
      <TextField disabled label="Disabled" value="Read-only value" variant="standard" />
    </Stack>
  ),
}

export const DialogFields: Story = {
  name: 'Dialog Fields',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack spacing={2} sx={{ width: 440 }}>
      <TextField autoFocus fullWidth label="Category name" margin="dense" variant="outlined" />
      <TextField
        fullWidth
        helperText="Search by path, size, or hash."
        label="Filter files"
        variant="outlined"
      />
      <TextField fullWidth label="Announcement Message" minRows={3} multiline variant="outlined" />
    </Stack>
  ),
}

export const SelectFields: Story = {
  name: 'Select Fields',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack spacing={2} sx={{ width: 440 }}>
      <TextField fullWidth label="Snapshot" select value="snapshot-a" variant="outlined">
        <MenuItem value="snapshot-a">snapshot-a.tar.gz</MenuItem>
        <MenuItem value="snapshot-b">snapshot-b.tar.gz</MenuItem>
      </TextField>
      <TextField
        disabled
        fullWidth
        helperText="Restore browsing is disabled until configured."
        label="Snapshot"
        select
        value=""
        variant="outlined"
      >
        <MenuItem value="">No snapshots available</MenuItem>
      </TextField>
    </Stack>
  ),
}

export const LoginFields: Story = {
  name: 'Login Fields',
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <TextField
        autoComplete="email"
        fullWidth
        label="Username"
        placeholder="username@example.ca"
        required
        type="email"
        variant="standard"
      />
      <TextField
        autoComplete="current-password"
        fullWidth
        label="Password"
        placeholder="Password"
        required
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton aria-label="toggle password visibility" edge="end" size="small">
                  <Visibility />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        type="password"
        variant="standard"
      />
    </Stack>
  ),
}
