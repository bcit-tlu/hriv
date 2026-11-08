import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import AddEditPersonModal from './AddEditPersonModal'
import type { PersonFormData } from './AddEditPersonModal'
import type { ApiUser } from '../api'

const guest: ApiUser = {
  id: 9,
  name: 'Guest Student',
  email: 'guest@example.invalid',
  role: 'student',
  active: true,
  has_local_password: true,
  oidc_linked: false,
  must_change_password: false,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
  last_access: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
const meta = {
  title: 'Components/AddEditPersonModal',
  component: AddEditPersonModal,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: {
    open: true,
    programs: [],
    onClose: fn(),
    onSave: fn() as (data: PersonFormData) => Promise<void>,
    onSetupLink: fn(),
  },
} satisfies Meta<typeof AddEditPersonModal>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {}
export const InviteMode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByLabelText('Invite by link (user sets their own password)'))
    await userEvent.type(canvas.getByLabelText('Full name'), 'Guest Student')
    await userEvent.type(canvas.getByLabelText('Email'), 'guest@example.invalid')
    await expect(canvas.getByRole('button', { name: 'Add' })).toBeEnabled()
  },
}
export const ForcedChange: Story = { args: { user: { ...guest, must_change_password: true } } }
export const LocalPassword: Story = {
  args: { user: guest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByRole('button', { name: 'Copy password-setup link' })).toBeDisabled()
    await waitFor(() =>
      expect(
        canvas.getByText(
          'Enter a new password to change it, or leave blank to keep the current one.',
        ),
      ).toBeVisible(),
    )
    await expect(canvas.queryByRole('switch', { name: 'Reset password' })).not.toBeInTheDocument()
    await expect(
      canvas.getByRole('checkbox', { name: 'Re-send password link' }),
    ).toBeInTheDocument()
  },
}
export const OidcManaged: Story = { args: { user: { ...guest, oidc_linked: true } } }
export const Passwordless: Story = {
  args: { user: { ...guest, has_local_password: false } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('button', {
        name: 'Copy password-setup link',
      }),
    ).toBeEnabled()
  },
}
export const ResendPasswordLink: Story = {
  args: { user: guest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Re-send password link' }))
    await expect(canvas.getByLabelText('Password (leave blank to keep)')).toBeDisabled()
    await expect(
      canvas.getByRole('switch', { name: 'Force password change on next login' }),
    ).toBeDisabled()
  },
}
