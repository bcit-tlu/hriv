import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import MarkerFormDialog from './MarkerFormDialog'
import { BOARD_FIXTURE, MARKER_FIXTURE } from './markerFixtures'
import { ApiError } from '../api'

const services = {
  fetchBoards: async () => [BOARD_FIXTURE],
  fetchBoard: async () => BOARD_FIXTURE,
  createBoard: async () => ({
    ...BOARD_FIXTURE,
    id: 2,
    name: 'My new Board',

    markers: [],
  }),
  createMarker: async () => MARKER_FIXTURE,
  updateMarker: async () => MARKER_FIXTURE,
  deleteMarker: async () => {},
}
const meta = {
  title: 'Components/MarkerFormDialog',
  component: MarkerFormDialog,
  args: { imageId: 42, view: MARKER_FIXTURE, services, onClose: () => {}, onChanged: () => {} },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MarkerFormDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('heading', { name: 'Add Marker' })).toBeInTheDocument()
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveFocus()
    await expect(page.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
  },
}
export const Edit: Story = {
  args: { item: MARKER_FIXTURE },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByText(BOARD_FIXTURE.name)).toBeVisible())
  },
}
export const BoardsMenu: Story = {
  args: {
    item: null,
    placement: true,
    services: {
      ...services,
      fetchBoards: async () => [
        BOARD_FIXTURE,
        { ...BOARD_FIXTURE, id: 3, name: 'Biology references' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          height: 560,
          background: 'url(/hriv-splash2.jpg) center/cover',
        }}
      >
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByRole('combobox', { name: 'Boards' })).toBeEnabled())
    await userEvent.click(page.getByRole('combobox', { name: 'Boards' }))
    await expect(page.getAllByRole('option')[0]).toHaveTextContent(BOARD_FIXTURE.name)
    await expect(page.getByRole('button', { name: '+ Create new board' })).toBeVisible()
  },
}
export const CreatePrivateBoard: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByRole('combobox', { name: 'Boards' })).toBeEnabled())
    await userEvent.click(page.getByRole('button', { name: '+ Create new board' }))
    await userEvent.type(page.getByLabelText('New private Board name'), 'Architecture favourites')
  },
}
export const ReadOnly: Story = {
  args: { item: { ...MARKER_FIXTURE, permissions: { can_edit: false, can_delete: false } } },
}
export const Placement: Story = {
  args: { placement: true },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          height: 560,
          background: 'url(/hriv-splash2.jpg) center/cover',
        }}
      >
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(page.queryByLabelText('Description')).not.toBeInTheDocument()
  },
}
export const StaleVersion: Story = {
  args: {
    item: MARKER_FIXTURE,
    services: {
      ...services,
      updateMarker: async () => {
        throw new ApiError(409, 'stale', { ...MARKER_FIXTURE, version: 4, title: 'Updated view' })
      },
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Save changes' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('changed since you opened it')
  },
}
