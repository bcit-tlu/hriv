import { useEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { ApiImage } from '../api'
import type { Collection, ImageItem, User } from '../types'
import SynchronizedCollectionViewer from './SynchronizedCollectionViewer'

const FIXED_AT = '2026-09-01T09:00:00Z'

function makeUser(): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'instructor',
    active: true,
    program_ids: [],
    program_names: [],
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
    logout: async () => undefined,
    addUser: () => undefined,
    deleteUser: () => undefined,
    refreshUsers: () => undefined,
    canManageUsers: false,
    canEditContent: true,
    canViewPeople: true,
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

function makeImage(id: number, name: string): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    // .storybook/static/sample.dzi parses but serves no tiles, so the viewer
    // mounts deterministically instead of racing an open-failed fallback.
    tileSources: '/sample.dzi',
    active: true,
    sortOrder: id,
    version: 1,
  }
}

function makeCollection(
  images: ImageItem[],
  canEdit: boolean,
  viewportState: Record<string, unknown> = {},
): Collection {
  return {
    id: 1,
    name: 'Skull comparison',
    description: null,
    type: 'synchronized',
    visibility: 'private',
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: images.length,
    coverThumb: '/hriv-splash2.jpg',
    categoryId: null,
    sortOrder: 0,
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: { canEdit, canDelete: canEdit, canChangeScope: canEdit, canTransfer: false },
    images,
    programIds: [],
    groupIds: [],
    viewportState,
    memberCount: images.length,
  }
}

const PAIR = makeCollection(
  [makeImage(101, 'Skull — frontal'), makeImage(102, 'Skull — lateral')],
  true,
)
const FOUR = makeCollection(
  [
    makeImage(101, 'Skull — frontal'),
    makeImage(102, 'Skull — lateral'),
    makeImage(103, 'Skull — occipital'),
    makeImage(104, 'Mandible — left'),
  ],
  true,
)
const READ_ONLY = makeCollection(
  [makeImage(101, 'Skull — frontal'), makeImage(102, 'Skull — lateral')],
  false,
)
const SINGLE = makeCollection([makeImage(101, 'Skull — frontal')], true)

interface StoryArgs {
  collection: Collection
  onSaveViewport: (state: Record<string, unknown>) => Promise<void>
  onOpenImage: (image: ImageItem) => void
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

function SynchronizedViewerExample(args: StoryArgs) {
  const user = makeUser()
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <SynchronizedCollectionViewer
        collection={args.collection}
        onSaveViewport={args.onSaveViewport}
        onOpenImage={args.onOpenImage}
        onImageRenewed={args.onImageRenewed}
        onError={args.onError}
      />
    </AuthContext.Provider>
  )
}

const PORTRAIT_MQL = {
  matches: true,
  media: '(orientation: portrait)',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  onchange: null,
  dispatchEvent: () => false,
} as MediaQueryList

/** Force `orientation: portrait` to match for the duration of one story. */
function ForcePortrait({ children }: { children: ReactNode }) {
  // Assignment happens during render (not in an effect): the child's
  // usePortrait lazy initializer reads matchMedia before any effect runs.
  const [original] = useState(() => window.matchMedia)
  window.matchMedia = ((query: string) =>
    query === '(orientation: portrait)'
      ? PORTRAIT_MQL
      : original(query)) as typeof window.matchMedia
  useEffect(() => {
    return () => {
      window.matchMedia = original
    }
  }, [original])
  return <>{children}</>
}

const meta = {
  title: 'Components/SynchronizedCollectionViewer',
  component: SynchronizedViewerExample,
  parameters: {
    layout: 'fullscreen',
    // OpenSeadragon keeps animating while tile fetch attempts fail in the
    // storybook sandbox; freeze it so Chromatic gets a stable frame.
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
    docs: {
      description: {
        component:
          'Two read-only OpenSeadragon panes with linked pan/zoom/rotation. A persisted per-image viewport restores the pair around different highlights; editors can save the current alignment, anyone can reset or unlink the views, and a portrait overlay asks users to rotate instead of unmounting the viewers.',
      },
    },
  },
  args: {
    collection: PAIR,
    onSaveViewport: fn(async () => undefined),
    onOpenImage: fn(),
    onImageRenewed: fn(),
    onError: fn(),
  },
} satisfies Meta<typeof SynchronizedViewerExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Link views')).toBeChecked()
    await expect(canvas.getByTestId('synchronized-save')).toBeEnabled()
    await userEvent.click(canvas.getAllByRole('button', { name: /^Open / })[0])
    await expect(args.onOpenImage).toHaveBeenCalledWith(PAIR.images[0])
  },
}

export const LargerSet: Story = {
  name: 'Larger Set',
  args: { collection: FOUR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Showing 2 of 4')).toBeInTheDocument()
  },
}

export const PortraitHint: Story = {
  name: 'Portrait Hint',
  decorators: [
    (Story) => (
      <ForcePortrait>
        <Story />
      </ForcePortrait>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('synchronized-portrait-hint')).toBeInTheDocument()
    await expect(canvas.getByText(/Rotate your device/)).toBeInTheDocument()
  },
}

export const ReadOnlyMember: Story = {
  name: 'Read-Only Member',
  args: { collection: READ_ONLY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId('synchronized-save')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('synchronized-reset')).toBeInTheDocument()
  },
}

export const TooFewImages: Story = {
  name: 'Too Few Images',
  args: { collection: SINGLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('synchronized-viewer-fallback')).toBeInTheDocument()
    await expect(canvas.getByText('1. Skull — frontal')).toBeInTheDocument()
  },
}
