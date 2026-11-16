import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import Box from '@mui/material/Box'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { ApiInuksuk, Collection, ImageItem } from '../types'
import ImageViewer from './ImageViewer'
import SequenceCollectionViewer from './SequenceCollectionViewer'
import SynchronizedCollectionViewer from './SynchronizedCollectionViewer'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from './inuksukFixtures'

const items: ApiInuksuk[] = [
  INUKSUK_FIXTURE,
  { ...INUKSUK_FIXTURE, id: 8, title: 'Stone columns', x: 0.7, y: 0.5 },
  {
    ...INUKSUK_FIXTURE,
    id: 9,
    title: 'Instructor example',
    x: 0.65,
    y: 0.7,
    source: 'instructor',
    permissions: { can_edit: false, can_delete: false },
  },
  {
    ...INUKSUK_FIXTURE,
    id: 10,
    title: 'Public inspiration',
    x: 0.4,
    y: 0.6,
    source: 'public',
    permissions: { can_edit: false, can_delete: false },
  },
]
const tileSource = { type: 'image', url: '/hriv-splash2.jpg', width: 1024, height: 1024 }
const auth: AuthContextValue = {
  currentUser: {
    id: 9,
    name: 'Alex',
    email: 'alex@example.com',
    role: 'student',
    active: true,
    program_ids: [],
    program_names: [],
    group_ids: [],
    group_names: [],
  },
  users: [],
  loading: false,
  login: async () => {},
  logout: () => {},
  addUser: () => {},
  deleteUser: () => {},
  refreshUsers: () => {},
  refreshCurrentUser: async () => {},
  canManageUsers: false,
  canEditContent: false,
  canViewPeople: false,
  oidcError: null,
  clearOidcError: () => {},
}
const images: ImageItem[] = [42, 43].map((id) => ({
  id,
  name: `Architecture ${id}`,
  tileSources: '/inuksuk-image.json',
  thumb: '/hriv-splash2.jpg',
  active: true,
  sortOrder: id,
  version: 1,
}))
const collection: Collection = {
  id: 1,
  name: 'Architecture study',
  description: null,
  type: 'sequence',
  visibility: 'private',
  hidden: false,
  owners: [],
  studentCurated: true,
  imageCount: 2,
  coverThumb: null,
  coverImageId: null,
  coverBlank: false,
  version: 1,
  categoryId: null,
  sortOrder: 0,
  programIds: [],
  groupIds: [],
  createdAt: INUKSUK_FIXTURE.created_at,
  updatedAt: INUKSUK_FIXTURE.updated_at,
  permissions: {
    canEdit: false,
    canDelete: false,
    canChangeScope: false,
    canTransfer: false,
    canHide: false,
  },
  images,
  viewportState: {},
  memberCount: 2,
}
function DrawerViewer({
  kind = 'image',
}: {
  kind?: 'image' | 'sequence' | 'synchronized'
  state?: 'ready' | 'empty' | 'error'
}) {
  const [itemId, setItemId] = useState<number | null>(42)
  return (
    <AuthContext.Provider value={auth}>
      <Box sx={{ p: 2, height: 700, maxWidth: 1200 }}>
        {kind === 'image' ? (
          <ImageViewer imageId={42} inuksuksEnabled height={620} tileSources={tileSource} />
        ) : kind === 'sequence' ? (
          <SequenceCollectionViewer
            collection={collection}
            itemId={itemId}
            onSelectItem={setItemId}
            onOpenImage={() => {}}
            onImageRenewed={() => {}}
            onError={() => {}}
            inuksuksEnabled
          />
        ) : (
          <SynchronizedCollectionViewer
            collection={{ ...collection, type: 'synchronized' }}
            onSaveViewport={async () => {}}
            onOpenImage={() => {}}
            onImageRenewed={() => {}}
            onError={() => {}}
            inuksuksEnabled
          />
        )}
      </Box>
    </AuthContext.Provider>
  )
}
const meta = {
  title: 'Components/ImageInuksuksDrawer',
  component: DrawerViewer,
  parameters: { layout: 'fullscreen' },
  beforeEach: ({ args }) => {
    localStorage.removeItem('hriv.inuksukVisibility.9')
    localStorage.removeItem('hrivpref:viewer-panel:user:9')
    localStorage.removeItem('hrivpref:inuksuks-drawer:pinned:user:9')
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, window.location.href).pathname
      const image = path.match(/^\/api\/images\/(\d+)\/inuksuks$/)
      if (image && args.state === 'empty') return Response.json([])
      if (image && args.state === 'error')
        return Response.json({ detail: 'Unable to load Inuksuks.' }, { status: 503 })
      if (image)
        return Response.json(
          items.map((item) => ({
            ...item,
            image_id: Number(image[1]),
            id: Number(image[1]) === 42 ? item.id : item.id + 100,
          })),
        )
      if (path === '/api/boards/1') return Response.json(BOARD_FIXTURE)
      if (path === '/api/boards') return Response.json([BOARD_FIXTURE])
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof DrawerViewer>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: 'Open viewer panel' })
    await userEvent.click(trigger)
    await expect(await canvas.findByRole('complementary')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Public Inuksuks' }))
    await expect(canvas.getByRole('button', { name: 'Public Inuksuks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const drawer = within(canvas.getByRole('complementary'))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' }))
    await waitFor(() =>
      expect(canvasElement.ownerDocument.querySelector('.MuiModal-root')).toBeNull(),
    )
    await userEvent.hover(
      drawer.getByRole('button', { name: 'View Inuksuk: Rose window (marker hidden)' }),
    )
    const row = drawer.getByRole('button', { name: 'View Inuksuk: Rose window (marker hidden)' })
    const bounds = row.getBoundingClientRect()
    const rowBounds = row.closest('li')!.getBoundingClientRect()
    await expect(bounds.left).toBe(rowBounds.left)
    await expect(bounds.right).toBe(rowBounds.right)
    await expect(row.querySelector('button')).toBeNull()
    await expect(canvasElement.querySelector('[data-inuksuk-id="7"]')).toBeEmptyDOMElement()
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' }))
    await waitFor(() =>
      expect(canvasElement.ownerDocument.querySelector('.MuiModal-root')).toBeNull(),
    )
  },
}
export const LabelOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Rose window options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Rose window options' }))
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('menuitemcheckbox', {
        name: 'Rose window labels',
      }),
    ).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(
      canvas.getAllByRole('button', { name: 'View Inuksuk: Rose window (marker hidden)' }),
    ).toHaveLength(1)
    const drawer = within(canvas.getByRole('complementary'))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await expect(
      canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }),
    ).toHaveAttribute('aria-checked', 'mixed')
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await expect(
      canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }),
    ).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
  },
}
export const PublicCollapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await expect(canvas.getByRole('button', { name: 'Public Inuksuks' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}
export const Sequence: Story = { args: { kind: 'sequence' }, play: PublicCollapsed.play }
export const Persistent: Story = {
  args: { kind: 'sequence' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Architecture 43' }))
    await expect(await canvas.findByRole('button', { name: 'Close viewer panel' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByRole('button', { name: 'Close viewer panel' })).toBeVisible()
  },
}
export const Permanent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await userEvent.click(canvasElement.querySelector<HTMLElement>('.openseadragon-canvas')!)
    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByRole('button', { name: 'Close viewer panel' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close viewer panel' }))
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
  },
}
export const Closed: Story = {}
export const OptionsMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Rose window options' }))
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).getByRole('menuitem', { name: 'Edit' }),
      ).toBeVisible(),
    )
    const tool = canvasElement.querySelector<HTMLElement>('[title="Add Inuksuk"]')
    await expect(tool).toBeVisible()
    const drawer = canvas.getByRole('complementary', { hidden: true }).getBoundingClientRect()
    const toolbar = tool!.getBoundingClientRect()
    await expect(drawer.left).toBeGreaterThanOrEqual(toolbar.right)
  },
}
export const Empty: Story = {
  args: { state: 'empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await expect(await canvas.findByText(/No Inuksuks on this image/)).toBeVisible()
  },
}
export const LoadError: Story = {
  args: { state: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('alert')
    await userEvent.click(canvas.getByRole('button', { name: 'Open viewer panel' }))
    await expect(within(canvas.getByRole('complementary')).getByRole('alert')).toBeVisible()
  },
}
export const Synchronized: Story = {
  args: { kind: 'synchronized' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const triggers = await canvas.findAllByRole('button', { name: 'Inuksuks (4)' })
    await userEvent.click(triggers[0])
    await expect(await canvas.findByRole('complementary', { name: /Inuksuks/ })).toBeVisible()
    const drawer = within(canvas.getByRole('complementary'))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' }))
    await userEvent.click(drawer.getByRole('button', { name: 'My Inuksuks options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' }))
    await expect(canvasElement.querySelector('[data-inuksuk-id="7"]')).toBeEmptyDOMElement()
    await expect(canvasElement.querySelector('[data-inuksuk-id="107"]')).toBeEmptyDOMElement()
  },
}
