import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ImageItem } from '../types'
import CollectionCoverPickerModal from './CollectionCoverPickerModal'

const members: ImageItem[] = [
  {
    id: 11,
    name: 'Frontal skull',
    thumb: '/hriv-splash2.jpg',
    tileSources: '/tiles/11.dzi',
    active: true,
    sortOrder: 0,
    version: 1,
  },
  {
    id: 12,
    name: 'Lateral skull',
    thumb: '/hriv-splash2.jpg',
    tileSources: '/tiles/12.dzi',
    active: true,
    sortOrder: 1,
    version: 1,
  },
  {
    id: 13,
    name: 'Mandible detail',
    thumb: '/hriv-splash2.jpg',
    tileSources: '/tiles/13.dzi',
    active: true,
    sortOrder: 2,
    version: 1,
  },
]

interface StoryArgs {
  images: ImageItem[]
  currentImageId: number | null
  onSave: (imageId: number | null) => void
  onClose: () => void
}

function CollectionCoverPickerExample({ images, currentImageId, onSave, onClose }: StoryArgs) {
  return (
    <CollectionCoverPickerModal
      open
      onClose={onClose}
      onSave={onSave}
      images={images}
      currentImageId={currentImageId}
    />
  )
}

const meta = {
  title: 'Components/CollectionCoverPickerModal',
  component: CollectionCoverPickerExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Radio picker for the collection tile cover — the member list comes from the loaded collection detail (tile summaries carry no images), in member order. Saving pins `cover_image_id`; the "None" option restores the first-member fallback.',
      },
    },
  },
  args: {
    images: members,
    currentImageId: null,
    onSave: fn(),
    onClose: fn(),
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<StoryArgs>

export const Basic: Story = {
  name: 'Fallback — no pinned cover',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('Choose Cover Image')).toBeInTheDocument()
    await expect(body.getByText('Lateral skull')).toBeInTheDocument()
    // No pin → the "None" row is pre-selected.
    const noneRow = (await body.findByText('None')).closest('tr')!
    await expect(within(noneRow).getByRole('radio')).toBeChecked()
  },
}

export const PinnedMember: Story = {
  name: 'Pinned member pre-selected',
  args: { currentImageId: 12 },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const row = (await body.findByText('Lateral skull')).closest('tr')!
    await expect(within(row).getByRole('radio')).toBeChecked()
    const noneRow = (await body.findByText('None')).closest('tr')!
    await expect(within(noneRow).getByRole('radio')).not.toBeChecked()
  },
}

export const PickAndSave: Story = {
  name: 'Pick a member and save',
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByText('Mandible detail'))
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith(13)
  },
}

export const Empty: Story = {
  name: 'Empty collection',
  args: { images: [] },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('No images available in this collection.')).toBeInTheDocument()
  },
}
