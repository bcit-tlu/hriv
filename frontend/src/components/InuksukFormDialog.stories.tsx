import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import InuksukFormDialog from './InuksukFormDialog'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from './inuksukFixtures'
import { ApiError } from '../api'

const services = {
  fetchBoards: async () => [BOARD_FIXTURE],
  fetchBoard: async () => BOARD_FIXTURE,
  createBoard: async () => ({
    ...BOARD_FIXTURE,
    id: 2,
    name: 'My new Board',

    inuksuks: [],
  }),
  createInuksuk: async () => INUKSUK_FIXTURE,
  updateInuksuk: async () => INUKSUK_FIXTURE,
  deleteInuksuk: async () => {},
}
const meta = {
  title: 'Components/InuksukFormDialog',
  component: InuksukFormDialog,
  args: { imageId: 42, view: INUKSUK_FIXTURE, services, onClose: () => {}, onChanged: () => {} },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InuksukFormDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('heading', { name: 'Save a view' })).toBeInTheDocument()
    await expect(page.getByRole('button', { name: 'Save to Board' })).toBeDisabled()
  },
}
export const Edit: Story = {
  args: { item: INUKSUK_FIXTURE },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByText(BOARD_FIXTURE.name)).toBeInTheDocument()
  },
}
export const CreatePrivateBoard: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('button', { name: '+ Create new board' }))
    await userEvent.type(page.getByLabelText('New private Board name'), 'Architecture favourites')
  },
}
export const ReadOnly: Story = {
  args: { item: { ...INUKSUK_FIXTURE, permissions: { can_edit: false, can_delete: false } } },
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
    item: INUKSUK_FIXTURE,
    services: {
      ...services,
      updateInuksuk: async () => {
        throw new ApiError(409, 'stale', { ...INUKSUK_FIXTURE, version: 4, title: 'Updated view' })
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
