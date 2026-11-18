import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardDialog from './BoardDialog'
import {
  BOARD_AUTH,
  BOARD_GROUPS,
  BOARD_PROGRAMS,
  BOARD_USER,
  installBoardsFetch,
} from './boardsFixtures'

const meta = {
  title: 'Components/BoardDialog',
  component: BoardDialog,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  args: {
    currentUser: BOARD_USER,
    programs: BOARD_PROGRAMS,
    groups: BOARD_GROUPS,
    onClose: fn(),
    onOpenMarker: fn(),
    onManage: fn(),
  },
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof BoardDialog>
export default meta
type Story = StoryObj<typeof meta>

function Wrapper(props: React.ComponentProps<typeof BoardDialog>) {
  return (
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardDialog {...props} />
    </AuthContext.Provider>
  )
}

/** An editable Board with marker tiles, favourites and owner management. */
export const Basic: Story = {
  args: { boardId: 1 },
  render: (args) => <Wrapper {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    const dialog = await canvas.findByRole('dialog', { name: 'Architecture inspiration' })
    const page = within(dialog)
    const marker = await page.findByRole('button', { name: 'Open Marker: Rose window' })
    await waitFor(() => expect(marker).toBeVisible())
    await waitFor(() =>
      expect(page.getByRole('button', { name: 'Open in Boards & Markers' })).toBeVisible(),
    )
    await waitFor(() => expect(page.getByRole('button', { name: 'Edit Board' })).toBeVisible())
  },
}

/** A public Board the viewer cannot edit: no Edit/owners affordances. */
export const ReadOnly: Story = {
  args: { boardId: 2 },
  render: (args) => <Wrapper {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    const dialog = await canvas.findByRole('dialog', { name: 'Shared discoveries' })
    const page = within(dialog)
    const marker = await page.findByRole('button', {
      name: 'Open Marker: Morgan’s shared view',
    })
    await waitFor(() => expect(marker).toBeVisible())
    await waitFor(() => expect(page.queryByRole('button', { name: 'Edit Board' })).toBeNull())
    await waitFor(() => expect(page.queryByRole('button', { name: 'Manage owners' })).toBeNull())
  },
}

/** A Board with no markers yet. */
export const Empty: Story = {
  args: { boardId: 3 },
  render: (args) => <Wrapper {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    const dialog = await canvas.findByRole('dialog', { name: 'Next studio project' })
    await waitFor(() =>
      expect(within(dialog).getByText('No Markers yet. Save a view from an image.')).toBeVisible(),
    )
  },
}
