import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Collection, ImageItem } from '../types'
import CollectionManageDialog from './CollectionManageDialog'

const FIXED_AT = '2026-09-01T09:00:00Z'

function makeImage(id: number, name: string): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    tileSources: '/sample.dzi',
    active: true,
    sortOrder: id,
    version: 1,
  }
}

function makeCollection(images: ImageItem[], memberCount = images.length): Collection {
  return {
    id: 2,
    name: 'Fracture healing timeline',
    description: null,
    type: 'sequence',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: memberCount,
    coverThumb: '/hriv-splash2.jpg',
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
    images,
    programIds: [],
    groupIds: [],
    viewportState: {},
    memberCount,
  }
}

const MANY = makeCollection([
  makeImage(101, 'Skull — frontal'),
  makeImage(102, 'Skull — lateral'),
  makeImage(103, 'Skull — occipital'),
  makeImage(104, 'Mandible — left'),
  makeImage(105, 'Mandible — right'),
  makeImage(106, 'Maxilla — anterior'),
])

const meta = {
  title: 'Components/CollectionManageDialog',
  component: CollectionManageDialog,
  args: {
    open: true,
    onClose: fn(),
    collection: MANY,
    onReorder: fn(async () => undefined),
    onRemoveImages: fn(async () => undefined),
    onAddImages: fn(),
    onImageRenewed: fn(),
    onError: fn(),
  },
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
  },
} satisfies Meta<typeof CollectionManageDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Member grid — filmstrip-size tiles with captions, a corner remove
    control each, and the "+" add-images action in the title. */
export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByTestId('collection-manage')).toBeInTheDocument()
    await expect(body.getAllByTestId(/^manage-tile-/)).toHaveLength(6)
    await userEvent.click(body.getByTestId('collection-manage-add'))
    await expect(args.onAddImages).toHaveBeenCalled()
  },
}

/** Empty collection — the add affordance stays reachable. */
export const Empty: Story = {
  args: { collection: makeCollection([]) },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByTestId('manage-empty')).toBeInTheDocument()
    await expect(body.getByTestId('collection-manage-add')).toBeInTheDocument()
  },
}

/** A member count larger than the rendered list notes the members hidden
    by restriction (they can't be managed from here). */
export const RestrictedMembersHidden: Story = {
  name: 'Restricted members hidden',
  args: { collection: makeCollection(MANY.images, MANY.images.length + 2) },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByText(/2 restricted images not shown/)).toBeInTheDocument()
  },
}
