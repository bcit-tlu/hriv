import { useEffect, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { ApiImage } from '../api'
import type { Collection, ImageItem, SlotViewport, User } from '../types'
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
    refreshCurrentUser: async () => undefined,
    canManageUsers: false,
    canEditContent: true,
    canViewPeople: true,
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

function makeImage(id: number, name: string, description?: string): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    // .storybook/static/sample.dzi parses but serves no tiles, so the viewer
    // mounts deterministically instead of racing an open-failed fallback.
    tileSources: '/sample.dzi',
    description,
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
    viewportState,
    memberCount: images.length,
  }
}

const PAIR = makeCollection(
  [
    makeImage(101, 'Skull — frontal', 'Hairline fracture, week two.'),
    makeImage(
      102,
      'Skull — lateral',
      'Follow-up scan after the cast was removed.\nCallus forming along the medial edge.\nHealing consistent with week six.\nCompare the cortical thickening against the baseline scan; remodelling continues through week twelve.',
    ),
  ],
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
  markersEnabled?: boolean
  collection: Collection
  onSaveViewport: (
    state: Record<string, unknown>,
    slots?: Record<string, SlotViewport | null>,
  ) => Promise<void>
  onOpenImage: (image: ImageItem) => void
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

function SynchronizedViewerExample(args: StoryArgs) {
  const user = makeUser()
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <SynchronizedCollectionViewer
        markersEnabled={args.markersEnabled}
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
  // Assignment happens inside the lazy initializer (still render, not an
  // effect): the child's usePortrait lazy initializer reads matchMedia
  // before any effect runs.
  const [original] = useState(() => {
    const orig = window.matchMedia
    window.matchMedia = ((query: string) =>
      query === '(orientation: portrait)' ? PORTRAIT_MQL : orig(query)) as typeof window.matchMedia
    return orig
  })
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
          'Two to four read-only OpenSeadragon panes with linked pan/zoom/rotation (side-by-side for a pair, 2×2 grid for three or four). A persisted per-image viewport restores the layout around different highlights; editors can set the current alignment as the default view, anyone can restore the default view or unpin a pane to navigate it independently, and a portrait overlay asks users to rotate instead of unmounting the viewers.',
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
    // Panes start linked (#1564; renamed pin→link in #1567): both show
    // "Unlink …" affordances.
    await expect(canvas.getAllByRole('button', { name: /^Unlink / })).toHaveLength(2)
    // Unlinking one swaps its affordance to "Link …" without touching the
    // other pane.
    await userEvent.click(canvas.getByRole('button', { name: 'Unlink Skull — frontal' }))
    await expect(canvas.getByRole('button', { name: 'Link Skull — frontal' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Unlink Skull — lateral' })).toBeInTheDocument()
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
    // All four members render in the 2×2 grid (#1561) — one caption each.
    await expect(canvas.getAllByRole('button', { name: /^Open / })).toHaveLength(4)
    await expect(canvas.queryByText(/^Showing \d+ of \d+$/)).not.toBeInTheDocument()
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

export const SameImageSlots: Story = {
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
      if (/^\/api\/images\/\d+\/markers$/.test(url.pathname)) return Response.json([])
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
  args: {
    markersEnabled: true,
    collection: makeCollection(
      [0.3, 0.7].map((x, index) => ({
        ...makeImage(101, 'Architectural study'),
        tileSources: '/marker-image.json',
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
    await expect(canvas.getByTestId('synchronized-viewer-frame-501')).toBeVisible()
    await expect(canvas.getByTestId('synchronized-viewer-frame-502')).toBeVisible()
    await waitFor(
      () => {
        for (const id of [501, 502]) {
          const image = canvas
            .getByTestId(`synchronized-viewer-frame-${id}`)
            .querySelector<HTMLCanvasElement>('.openseadragon-canvas canvas')
          const context = image?.getContext('2d')
          const pixel = context?.getImageData(image!.width / 2, image!.height / 2, 1, 1).data
          expect(pixel?.[0]).toBeGreaterThan(70)
        }
      },
      { timeout: 10000 },
    )
    await expect(canvas.getByTestId('synchronized-save')).toBeEnabled()
    await userEvent.click(canvas.getByTestId('synchronized-save'))
    await expect(args.onSaveViewport).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        '501': expect.objectContaining({ zoom: 2 }),
        '502': expect.objectContaining({ zoom: 2 }),
      }),
    )
  },
}
