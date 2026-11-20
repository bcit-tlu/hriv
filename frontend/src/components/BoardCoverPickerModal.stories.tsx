import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ApiMarker } from '../types'
import { MARKER_FIXTURE } from './markerFixtures'
import BoardCoverPickerModal from './BoardCoverPickerModal'

const members: ApiMarker[] = [
  MARKER_FIXTURE,
  {
    ...MARKER_FIXTURE,
    id: 8,
    title: 'Bell tower',
    sort_order: 1,
  },
  {
    ...MARKER_FIXTURE,
    id: 9,
    title: 'Nave detail',
    sort_order: 2,
  },
]

interface StoryArgs {
  markers: ApiMarker[]
  currentMarkerId: number | null
  currentBlank: boolean
  onSave: (markerId: number | null, blank: boolean) => void
  onClose: () => void
}

function BoardCoverPickerExample({
  markers,
  currentMarkerId,
  currentBlank,
  onSave,
  onClose,
}: StoryArgs) {
  return (
    <BoardCoverPickerModal
      open
      onClose={onClose}
      onSave={onSave}
      markers={markers}
      currentMarkerId={currentMarkerId}
      currentBlank={currentBlank}
    />
  )
}

const meta = {
  title: 'Components/BoardCoverPickerModal',
  component: BoardCoverPickerExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Radio picker for the board tile cover — the member list comes from the loaded board detail (tile summaries carry no markers), in member order. Saving pins `cover_marker_id`; "Automatic" clears it for the first-member fallback, and "None" shows the blank type-logo tile.',
      },
    },
  },
  args: {
    markers: members,
    currentMarkerId: null,
    currentBlank: false,
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
    await expect(body.getByText('Bell tower')).toBeInTheDocument()
    // No pin, no blank → the "Automatic" row is pre-selected.
    const autoRow = (await body.findByText('Automatic')).closest('tr')!
    await expect(within(autoRow).getByRole('radio')).toBeChecked()
  },
}

export const BlankCover: Story = {
  name: 'Blank — type-logo tile',
  args: { currentBlank: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const noneRow = (await body.findByText('None')).closest('tr')!
    await expect(within(noneRow).getByRole('radio')).toBeChecked()
    const autoRow = (await body.findByText('Automatic')).closest('tr')!
    await expect(within(autoRow).getByRole('radio')).not.toBeChecked()
  },
}

export const PinnedMember: Story = {
  name: 'Pinned member pre-selected',
  args: { currentMarkerId: 8 },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const row = (await body.findByText('Bell tower')).closest('tr')!
    await expect(within(row).getByRole('radio')).toBeChecked()
    const noneRow = (await body.findByText('None')).closest('tr')!
    await expect(within(noneRow).getByRole('radio')).not.toBeChecked()
  },
}

export const PickAndSave: Story = {
  name: 'Pick a member and save',
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByText('Nave detail'))
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith(9, false)
  },
}

export const Empty: Story = {
  name: 'Empty board',
  args: { markers: [] },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('No Markers available on this Board.')).toBeInTheDocument()
  },
}
