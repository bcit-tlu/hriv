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
    onClearPassword: fn() as () => Promise<void>,
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
export const OidcManaged: Story = { args: { user: { ...guest, oidc_linked: true } } }
export const Passwordless: Story = { args: { user: { ...guest, has_local_password: false } } }
export const ClearPasswordConfirm: Story = {
  args: { user: guest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Clear password' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Clear password?' })).toBeVisible(),
    )
  },
}
