import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import PasswordSetupLinkDialog from './PasswordSetupLinkDialog'

const meta = {
  title: 'Components/PasswordSetupLinkDialog',
  component: PasswordSetupLinkDialog,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: { user: { id: 9, name: 'Guest Student', active: true }, onClose: fn() },
  beforeEach: ({ parameters }) => {
    const original = globalThis.fetch
    globalThis.fetch = async () => {
      if (parameters.mintState === 'pending') return new Promise<Response>(() => {})
      return new Response(
        JSON.stringify(
          parameters.mintState === 'error'
            ? { detail: 'Link service unavailable. Please retry.' }
            : { setup_token: 'storybook-setup-token', expires_at: '2030-01-02T12:00:00Z' },
        ),
        { status: parameters.mintState === 'error' ? 503 : 200 },
      )
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof PasswordSetupLinkDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement.ownerDocument.body).findByLabelText('Setup URL'),
    ).toBeVisible()
  },
}
export const Creating: Story = { parameters: { mintState: 'pending' } }
export const MintFailed: Story = {
  parameters: { mintState: 'error' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement.ownerDocument.body).findByText(
        'Could not create a setup link. Retry here or from the person’s row.',
      ),
    ).toBeVisible()
  },
}
export const PasswordCleared: Story = { args: { passwordCleared: true } }
export const InactiveAccount: Story = {
  args: { user: { id: 9, name: 'Inactive Guest', active: false } },
}
