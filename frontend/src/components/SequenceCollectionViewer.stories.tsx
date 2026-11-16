import { useState } from 'react'
import Box from '@mui/material/Box'
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
    refreshCurrentUser: async () => undefined,
    canManageUsers: false,
    canEditContent: true,
    canViewPeople: true,
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

function makeImage(id: number, name: string, note?: string): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    // .storybook/static/sample.dzi parses but serves no tiles, so the viewer
    // mounts deterministically instead of racing an open-failed path.
    tileSources: '/sample.dzi',
    note,
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
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace', role: 'instructor' }],
    studentCurated: false,
    imageCount: images.length,
    coverThumb: '/hriv-splash2.jpg',
    coverImageId: null,
    coverBlank: false,
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
    makeImage(101, 'Skull — frontal', 'Hairline fracture, week two.'),
    makeImage(
      102,
      'Skull — lateral',
      'Follow-up scan after the cast was removed.\nCallus forming along the medial edge.\nHealing consistent with week six.\nCompare the cortical thickening against the baseline scan; remodelling continues through week twelve.',
    ),
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
const EMPTY_READ_ONLY = makeCollection([], false)

interface StoryArgs {
  inuksuksEnabled?: boolean
  collection: Collection
  itemId: number | null
  onSelectItem: (id: number, slotId?: number) => void
  onOpenImage: (image: ImageItem) => void
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
  canEditContent?: boolean
}

function SequenceViewerExample(args: StoryArgs) {
  const [itemId, setItemId] = useState<number | null>(args.itemId)
  const [slotId, setSlotId] = useState<number | null>(null)
  const user = makeUser()
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <SequenceCollectionViewer
        inuksuksEnabled={args.inuksuksEnabled}
        slotId={slotId}
        collection={args.collection}
        itemId={itemId}
        onSelectItem={(id, slot) => {
          setItemId(id)
          setSlotId(slot ?? null)
          if (slot != null) args.onSelectItem(id, slot)
          else args.onSelectItem(id)
        }}
        onOpenImage={args.onOpenImage}
        onImageRenewed={args.onImageRenewed}
        onError={args.onError}
        canEditContent={args.canEditContent}
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
          'One-image-at-a-time viewer for sequence collections: a filmstrip above the image, lightbox-style Previous/Next edge buttons that appear on pointer activity, a caption row with the member name, position readout and Open image button, and autofocused arrow-key support. Member management (reorder/add/remove) lives in the Manage dialog on the collection page (#1566). With canEditContent (admin/instructor) the viewer also offers canvas annotation editing and overlay locking on the active member (#1863).',
      },
    },
  },
  args: {
    collection: MANY_IMAGES,
    itemId: null,
    onSelectItem: fn(),
    onOpenImage: fn(),
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

export const ReadOnlyMember: Story = {
  name: 'Read-Only Member',
  args: { collection: READ_ONLY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('1 of 2')
  },
}

// #1863 — admins/instructors annotate the active member and lock overlays
// in place; the toolbar gains the canvas-edit affordance versus `Basic`.
export const Annotatable: Story = {
  name: 'Annotatable (admin/instructor)',
  args: { collection: MANY_IMAGES, canEditContent: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('1 of 6')
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

export const EmptySequenceReadOnly: Story = {
  name: 'Empty Sequence Read Only',
  args: { collection: EMPTY_READ_ONLY },
}

export const SameImageSlots: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Two saved views of one image. The filmstrip is image-only; each button keeps its slot label as an accessible name, and the active view caption remains below the viewport.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </Box>
    ),
  ],
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      )
      if (/^\/api\/images\/\d+\/inuksuks$/.test(url.pathname)) return Response.json([])
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
  args: {
    inuksuksEnabled: true,
    collection: makeCollection(
      [0.3, 0.7].map((x, index) => ({
        ...makeImage(101, 'Architectural study'),
        tileSources: '/inuksuk-image.json',
        slot: {
          id: 501 + index,
          label: index ? 'Right study' : 'Left study',
          thumb: '/hriv-splash2.jpg',
          viewport_state: { x, y: 0.4, zoom: 2, rotation: index * 15 },
        },
      })),
      true,
    ),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('sequence-thumbnail-strip').textContent).toBe('')
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Right study' }))
    await expect(canvas.getByRole('button', { name: 'Go to Right study' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(canvas.getByTestId('sequence-position')).toHaveTextContent('2 of 2')
    await expect(args.onSelectItem).toHaveBeenCalledWith(101, 502)
    await expect(canvas.getByRole('heading', { name: 'Right study' })).toBeVisible()
  },
}
