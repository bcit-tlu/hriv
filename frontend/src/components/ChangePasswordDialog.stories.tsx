import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ChangePasswordDialog, { ForcedPasswordChangeScreen } from './ChangePasswordDialog'

const meta = {
  title: 'Components/ChangePasswordDialog',
  component: ChangePasswordDialog,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: { open: true, onSuccess: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof ChangePasswordDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

export const MismatchedConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.type(canvas.getByLabelText(/^Current password/), 'old-password')
    await userEvent.type(canvas.getByLabelText(/^New password/), 'new-password')
    await userEvent.type(canvas.getByLabelText(/^Confirm new password/), 'different')
    await expect(canvas.getByRole('button', { name: 'Change password' })).toBeDisabled()
  },
}

export const ForcedChangeScreen: Story = {
  render: (args) => (
    <ForcedPasswordChangeScreen onSuccess={args.onSuccess} onSignOut={args.onClose} />
  ),
}
