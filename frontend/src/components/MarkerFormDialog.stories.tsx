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
  fetchPrograms: async () => [
    {
      id: 1,
      name: 'Medical Laboratory Science',
      oidc_group: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  fetchGroups: async () => [
    {
      id: 1,
      name: 'Cohort A',
      description: null,
      created_by_user_id: 9,
      member_ids: [],
      instructor_ids: [9],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
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
    await waitFor(() => expect(page.getByRole('textbox', { name: 'Title' })).toHaveFocus())
    // No Board chosen yet: the split button's main action opens the picker.
    await waitFor(() => expect(page.getByRole('button', { name: 'Save to…' })).toBeEnabled())
  },
}
export const Edit: Story = {
  args: { item: MARKER_FIXTURE },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByText(BOARD_FIXTURE.name)).toBeVisible())
  },
}
export const SaveToPicker: Story = {
  args: {
    item: null,
    placement: true,
    services: {
      ...services,
      fetchBoards: async () => [
        BOARD_FIXTURE,
        { ...BOARD_FIXTURE, id: 3, name: 'Biology references', marker_count: 4 },
        { ...BOARD_FIXTURE, id: 4, name: 'Histology', marker_count: 12 },
        { ...BOARD_FIXTURE, id: 5, name: 'Cell structure review', marker_count: 1 },
        { ...BOARD_FIXTURE, id: 6, name: 'Exam prep', marker_count: 7 },
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
    await waitFor(() => expect(page.getByRole('button', { name: 'Choose Boards' })).toBeEnabled())
    await userEvent.click(page.getByRole('button', { name: 'Choose Boards' }))
    const picker = await page.findByRole('dialog', { name: 'Save to' })
    const histology = within(picker).getByText('Histology').closest('[role="button"]')!
    await userEvent.click(histology)
    await expect(histology).toHaveAttribute('aria-pressed', 'true')
  },
}
export const ManyBoards: Story = {
  args: {
    item: null,
    placement: true,
    services: {
      ...services,
      fetchBoards: async () =>
        Array.from({ length: 40 }, (_, index) => ({
          ...BOARD_FIXTURE,
          id: index + 1,
          name: index % 3 ? `Board ${index + 1}` : `Histology review set ${index + 1}`,
        })),
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByRole('button', { name: 'Choose Boards' })).toBeEnabled())
    await userEvent.click(page.getByRole('button', { name: 'Choose Boards' }))
    const search = await page.findByLabelText('Search Boards')
    await userEvent.type(search, 'review')
    const picker = page.getByRole('dialog', { name: 'Save to' })
    await expect(within(picker).getByText('Histology review set 1')).toBeVisible()
    await expect(within(picker).queryByText('Board 2')).toBeNull()
  },
}
export const EditSavedTo: Story = {
  args: { item: { ...MARKER_FIXTURE, board_ids: [1, 3] } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const savedTo = await page.findByRole('region', { name: 'Saved to' })
    await waitFor(() => expect(within(savedTo).getAllByRole('listitem').length).toBeGreaterThan(0))
  },
}
export const CreatePrivateBoard: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const add = /^(Choose Boards|Save to another Board)$/
    await waitFor(() => expect(page.getByRole('button', { name: add })).toBeEnabled())
    await userEvent.click(page.getByRole('button', { name: add }))
    const picker = await page.findByRole('dialog', { name: 'Save to' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Create Board' }))
    await expect(page.getByRole('heading', { name: 'New Board' })).toBeVisible()
    await userEvent.type(page.getByLabelText('Name *', { exact: true }), 'Architecture favourites')
    await expect(page.getByRole('button', { name: 'Create Board' })).toBeEnabled()
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
    // The canvas popover follows the standalone dialog's layout — the
    // Description field is always visible, no collapsed More options.
    await expect(page.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
    await expect(page.getByLabelText('Description')).toBeVisible()
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
