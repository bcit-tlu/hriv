import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { ApiImage } from '../api'
import type { Collection, ImageItem, User } from '../types'
import SequenceCollectionViewer from './SequenceCollectionViewer'

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
    logout: () => undefined,
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
    // mounts deterministically instead of racing an open-failed path.
    tileSources: '/sample.dzi',
    active: true,
    sortOrder: id,
    version: 1,
  }
}

function makeCollection(images: ImageItem[], canEdit: boolean): Collection {
  return {
    id: 2,
    name: 'Fracture healing timeline',
    description: null,
    type: 'sequence',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: images.length,
    coverThumb: '/hriv-splash2.jpg',
    categoryId: null,
    sortOrder: 0,
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: {
      canEdit,
      canDelete: canEdit,
      canChangeScope: canEdit,
      canTransfer: false,
      canHide: false,
    },
    images,
    programIds: [],
    groupIds: [],
    viewportState: {},
    memberCount: images.length,
  }
}

const ONE_IMAGE = makeCollection([makeImage(101, 'Skull — frontal')], true)
const MANY_IMAGES = makeCollection(
  [
    makeImage(101, 'Skull — frontal'),
    makeImage(102, 'Skull — lateral'),
    makeImage(103, 'Skull — occipital'),
    makeImage(104, 'Mandible — left'),
    makeImage(105, 'Mandible — right'),
    makeImage(106, 'Maxilla — anterior'),
  ],
  true,
)
const READ_ONLY = makeCollection(
  [makeImage(101, 'Skull — frontal'), makeImage(102, 'Skull — lateral')],
  false,
)
const EMPTY = makeCollection([], true)

interface StoryArgs {
  collection: Collection
  itemId: number | null
  reordering: boolean
  onSelectItem: (id: number) => void
  onOpenImage: (image: ImageItem) => void
  onReorder: (imageIds: number[]) => Promise<void>
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

function SequenceViewerExample(args: StoryArgs) {
  const [itemId, setItemId] = useState<number | null>(args.itemId)
  const [reordering, setReordering] = useState(args.reordering)
  const user = makeUser()
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <SequenceCollectionViewer
        collection={args.collection}
        itemId={itemId}
        onSelectItem={(id) => {
          setItemId(id)
          args.onSelectItem(id)
        }}
        onOpenImage={args.onOpenImage}
        onReorder={args.onReorder}
        onImageRenewed={args.onImageRenewed}
        onError={args.onError}
        reordering={reordering}
        onReorderingChange={setReordering}
      />
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/SequenceCollectionViewer',
  component: SequenceViewerExample,
  parameters: {
    layout: 'fullscreen',
    // OpenSeadragon keeps animating while tile fetch attempts fail in the
    // storybook sandbox; freeze it so Chromatic gets a stable frame.
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
    docs: {
      description: {
        component:
          'Read-only one-image-at-a-time viewer for sequence collections: lightbox-style Previous/Next edge buttons that appear on pointer activity, position readout, Open image link, thumbnail strip navigation, arrow-key support, and an editor-only reorder mode backed by the collection images endpoint.',
      },
    },
  },
  args: {
    collection: MANY_IMAGES,
    itemId: null,
    reordering: false,
    onSelectItem: fn(),
    onOpenImage: fn(),
    onReorder: fn(async () => undefined),
    onImageRenewed: fn(),
    onError: fn(),
  },
} satisfies Meta<typeof SequenceViewerExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('1 of 6')
    // The edge-overlay nav only becomes interactive on pointer activity
    // (#1561) — hover the frame the way a real user would before clicking.
    await userEvent.hover(canvas.getByTestId('sequence-viewer-frame'))
    await userEvent.click(canvas.getByRole('button', { name: 'Next image' }))
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('2 of 6')
    await expect(args.onSelectItem).toHaveBeenCalledWith(102)
  },
}

export const SingleImage: Story = {
  name: 'Single Image',
  args: { collection: ONE_IMAGE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('1 of 1')
    await expect(canvas.getByRole('button', { name: 'Previous image' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Next image' })).toBeDisabled()
  },
}

export const ReorderMode: Story = {
  name: 'Reorder Mode',
  args: { collection: MANY_IMAGES, reordering: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The Reorder/Done toggle lives in the collection detail header (#1559);
    // the viewer receives `reordering` as a controlled prop.
    await expect(
      canvas.getByText('Drag the thumbnails to reorder the sequence, then choose Done.'),
    ).toBeInTheDocument()
  },
}

export const ReadOnlyMember: Story = {
  name: 'Read-Only Member',
  args: { collection: READ_ONLY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByText('Drag the thumbnails to reorder the sequence, then choose Done.'),
    ).not.toBeInTheDocument()
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('1 of 2')
  },
}

export const EmptySequence: Story = {
  name: 'Empty Sequence',
  args: { collection: EMPTY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-viewer-empty')).toBeInTheDocument()
  },
}
