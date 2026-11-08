import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import PeoplePage from './PeoplePage'
import type { ApiUser } from '../api'

const base: ApiUser = {
  id: 1,
  name: 'Local Guest',
  email: 'local@example.invalid',
  role: 'student',
  active: true,
  has_local_password: true,
  oidc_linked: false,
  must_change_password: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
  last_access: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
const rows = [
  base,
  {
    ...base,
    id: 2,
    name: 'SSO Instructor',
    email: 'sso@example.invalid',
    role: 'instructor',
    oidc_linked: true,
    must_change_password: false,
  },
  {
    ...base,
    id: 3,
    name: 'Invited Guest',
    email: 'invited@example.invalid',
    has_local_password: false,
    must_change_password: false,
  },
  {
    ...base,
    id: 4,
    name: 'Inactive Guest',
    email: 'inactive@example.invalid',
    active: false,
    has_local_password: false,
    must_change_password: false,
  },
]
const meta = {
  title: 'Components/PeoplePage',
  component: PeoplePage,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: { programs: [], groups: [] },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify(rows), { status: 200 })
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof PeoplePage>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Local Guest')).toBeVisible()
    await expect(within(canvasElement).getByRole('columnheader', { name: 'Sign-in' })).toBeVisible()
    await expect(within(canvasElement).getByRole('cell', { name: /^Local Guest$/ })).toBeVisible()
  },
}
export const ReadOnlyDirectory: Story = { args: { readOnly: true }, play: Basic.play }
