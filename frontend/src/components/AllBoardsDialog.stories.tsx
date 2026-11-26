import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import AllBoardsDialog from './AllBoardsDialog'
import { BOARD_DISCOVERY_FIXTURES, BOARD_USER, installBoardsFetch } from './boardsFixtures'

const meta = {
  title: 'Components/AllBoardsDialog',
  component: AllBoardsDialog,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: {
    open: true,
    onClose: fn(),
    boards: BOARD_DISCOVERY_FIXTURES,
    recent: [],
    loading: false,
    error: null,
    currentUser: { ...BOARD_USER, role: 'admin' },
    onOpenBoard: fn(),
  },
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof AllBoardsDialog>
export default meta
type Story = StoryObj<typeof meta>

const dialogOf = async (canvasElement: HTMLElement) => {
  const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
    name: 'All Boards',
  })
  // The dialog fades in from opacity 0.
  await waitFor(() => expect(dialog).toBeVisible())
  return dialog
}

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await dialogOf(canvasElement)
    await expect(within(dialog).getAllByTestId('board-card')).toHaveLength(
      BOARD_DISCOVERY_FIXTURES.length,
    )
  },
}

export const TableView: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await dialogOf(canvasElement)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Table view' }))
    const table = within(dialog).getByRole('table', { name: 'All Boards' })
    await expect(within(table).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(
      BOARD_DISCOVERY_FIXTURES.length,
    )
  },
}

export const Empty: Story = {
  args: { boards: [] },
  play: async ({ canvasElement }) => {
    const dialog = await dialogOf(canvasElement)
    await expect(within(dialog).getByText('No Boards available.')).toBeVisible()
  },
}
