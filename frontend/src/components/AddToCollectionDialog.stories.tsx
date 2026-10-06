import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { CollectionSummary, Program, Role, User } from '../types'
import AddToCollectionDialog, {
  CAP_REACHED_TOOLTIP,
  type AddToCollectionDialogProps,
} from './AddToCollectionDialog'

const FIXED_AT = '2026-09-01T09:00:00Z'

const programs: Program[] = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
]

function makeUser(role: Role): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role,
    active: true,
    program_ids: [1],
    program_names: ['Radiography'],
    group_ids: [],
    group_names: [],
  }
}

function makeAuth(user: User): AuthContextValue {
  return {
    currentUser: user,
    users: [],
    loading: false,
    login: async () => undefined,
    logout: () => undefined,
    addUser: () => undefined,
    deleteUser: () => undefined,
    refreshUsers: () => undefined,
    canManageUsers: user.role === 'admin',
    canEditContent: user.role === 'admin' || user.role === 'instructor',
    canViewPeople: user.role !== 'student',
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

function makeSummary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: null,
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: null,
    categoryId: null,
    sortOrder: 0,
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: {
      canEdit: true,
      canDelete: true,
      canChangeScope: true,
      canTransfer: false,
      canHide: false,
    },
    ...overrides,
  }
}

const populated: CollectionSummary[] = [
  makeSummary(),
  makeSummary({
    id: 2,
    name: 'Long bone fracture sequence',
    type: 'sequence',
    visibility: 'public',
    hidden: false,
    imageCount: 9,
  }),
  makeSummary({
    id: 3,
    name: 'Radiography — chest positioning',
    type: 'sequence',
    visibility: 'restricted',
    hidden: false,
    owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
    imageCount: 4,
  }),
  makeSummary({
    id: 4,
    name: 'Dental panoramic pairs',
    type: 'synchronized',
    owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
    imageCount: 1,
  }),
]

type StoryArgs = AddToCollectionDialogProps & { role: Role }

function AddToCollectionDialogExample({ role, ...props }: StoryArgs) {
  return (
    <AuthContext.Provider value={makeAuth(makeUser(role))}>
      <AddToCollectionDialog {...props} />
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/AddToCollectionDialog',
  component: AddToCollectionDialogExample,
  args: {
    role: 'instructor',
    open: true,
    onClose: fn(),
    imageIds: [42],
    collections: populated,
    loading: false,
    error: null,
    programs,
    groups: [],
    onAdd: fn(async () => true),
    onCreate: fn(async () => undefined),
  },
  argTypes: {
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor', 'staff', 'student'] satisfies Role[],
      description: 'Signed-in role (drives grouping and the New collection form)',
    },
  },
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
  },
} satisfies Meta<typeof AddToCollectionDialogExample>

export default meta

type Story = StoryObj<typeof meta>

/** Instructor with personal and program-owned collections to choose from. */
export const Basic: Story = {
  args: { role: 'instructor' },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Add to Skull comparison' }))
    await expect(args.onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  },
}

/** Student with no editable collections yet — only the create path remains. */
export const Empty: Story = {
  args: { role: 'student', collections: [] },
}

/** A synchronized collection already at the four-image cap is disabled with a tooltip. */
export const CapReached: Story = {
  args: {
    role: 'student',
    collections: [
      makeSummary({ id: 1, name: 'Four-up comparison', imageCount: 4 }),
      makeSummary({ id: 2, name: 'Open sequence', type: 'sequence', imageCount: 4 }),
    ],
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const full = await body.findByRole('button', { name: 'Add to Four-up comparison' })
    await expect(full).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(full.parentElement as HTMLElement)
    await expect(await body.findByText(CAP_REACHED_TOOLTIP)).toBeInTheDocument()
  },
}

/** The collection list failed to load. */
export const LoadError: Story = {
  args: { role: 'student', collections: [], error: 'Failed to load collections.' },
}

/** Filter narrows the list; the nothing-matches copy echoes the query. */
export const Filtered: Story = {
  args: { role: 'instructor' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByRole('textbox', { name: 'Filter collections' }), 'dental')
    await expect(body.getByRole('button', { name: 'Add to Dental panoramic pairs' })).toBeVisible()
    await expect(body.queryByRole('button', { name: 'Add to Skull comparison' })).toBeNull()
  },
}

/** "New collection…" opens the shared create form with the image preselected. */
export const CreateNew: Story = {
  args: { role: 'student' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'New collection…' }))
    const heading = await body.findByRole('heading', { name: 'New Collection' })
    await waitFor(() => expect(heading).toBeVisible())
  },
}
