import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ApiError } from '../api'
import PasswordSetupScreen from './PasswordSetupScreen'

const meta = {
  title: 'Components/PasswordSetupScreen',
  component: PasswordSetupScreen,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: {
    onSubmit: fn(async () => undefined) as (password: string) => Promise<void>,
    onSignIn: fn(),
  },
} satisfies Meta<typeof PasswordSetupScreen>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

const submit: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.type(canvas.getByLabelText(/^New password/), 'new-password')
  await userEvent.type(canvas.getByLabelText(/^Confirm new password/), 'new-password')
  await userEvent.click(canvas.getByRole('button', { name: 'Set password' }))
}

export const Submitting: Story = {
  args: { onSubmit: () => new Promise(() => {}) },
  play: async (context) => {
    await submit(context)
    await expect(
      within(context.canvasElement).getByRole('button', { name: 'Setting password…' }),
    ).toBeDisabled()
  },
}

export const ExpiredLink: Story = {
  args: {
    onSubmit: async () => {
      throw new ApiError(401, 'invalid_token')
    },
  },
  play: async (context) => {
    await submit(context)
    await expect(within(context.canvasElement).getByRole('alert')).toHaveTextContent(
      'This link has expired',
    )
  },
}

export const AlreadySet: Story = {
  args: {
    onSubmit: async () => {
      throw new ApiError(409, 'password_already_set')
    },
  },
  play: submit,
}

export const InactiveAccount: Story = {
  args: {
    onSubmit: async () => {
      throw new ApiError(403, 'account_inactive')
    },
  },
  play: submit,
}

export const Throttled: Story = {
  args: {
    onSubmit: async () => {
      throw new ApiError(429, 'rate_limited')
    },
  },
  play: submit,
}
