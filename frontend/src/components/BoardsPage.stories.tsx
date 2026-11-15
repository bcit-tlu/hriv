import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardsPage from './BoardsPage'
import {
  BOARD_AUTH,
  BOARD_GROUPS,
  BOARD_PROGRAMS,
  BOARD_USER,
  installBoardsFetch,
} from './boardsFixtures'

const writes = fn()
function Example({
  initialBoardId = null,
  state = 'ready',
}: {
  initialBoardId?: number | null
  state?: 'ready' | 'empty' | 'error'
}) {
  const [selection, setSelection] = useState<{ boardId: number | null; sectionId: number | null }>({
    boardId: initialBoardId,
    sectionId: null,
  })
  return (
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardsPage
        key={`${selection.boardId}:${state}`}
        enabled
        currentUser={BOARD_USER}
        programs={BOARD_PROGRAMS}
        groups={BOARD_GROUPS}
        {...selection}
        onSelectBoard={(boardId, sectionId = null) => setSelection({ boardId, sectionId })}
        onOpenInuksuk={fn()}
      />
    </AuthContext.Provider>
  )
}
const meta = {
  title: 'Components/BoardsPage',
  component: Example,
  parameters: { layout: 'fullscreen' },
  beforeEach: ({ args }) => {
    writes.mockClear()
    return installBoardsFetch(args.state, writes)
  },
} satisfies Meta<typeof Example>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' }),
    ).toBeVisible()
  },
}
export const SelectedBoard: Story = {
  args: { initialBoardId: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Windows' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Unsectioned' })).toBeVisible()
  },
}
export const Favourites: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' })
    await userEvent.click(canvas.getByRole('switch', { name: 'Favourites only' }))
    await expect(await canvas.findByRole('heading', { name: 'Favourite Inuksuks' })).toBeVisible()
  },
}
export const Shared: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Board: Architecture inspiration' })
    await userEvent.click(canvas.getByRole('tab', { name: 'Shared with me / Public' }))
    await expect(
      await canvas.findByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).toBeVisible()
  },
}
export const Empty: Story = { args: { state: 'empty' } }
export const ErrorState: Story = { args: { state: 'error' } }
export const KeyboardReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handle = await canvas.findByRole('button', { name: 'Reorder Architecture inspiration' })
    handle.focus()
    await userEvent.keyboard('[Space][ArrowRight][Space]')
    await waitFor(() =>
      expect(writes.mock.calls.some((call) => call[0] === '/api/boards/order')).toBe(true),
    )
    await waitFor(() =>
      expect(canvas.getAllByRole('button', { name: /^Open Board:/ })[0]).toHaveAccessibleName(
        'Open Board: Next studio project',
      ),
    )
  },
}
