import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardsPage from './BoardsPage'
import {
  BOARD_AUTH,
  BOARDS_FIXTURES,
  BOARD_GROUPS,
  BOARD_PROGRAMS,
  BOARD_USER,
  installBoardsFetch,
} from './boardsFixtures'

const writes = fn()
function Example({
  initialBoardId = null,
  state = 'ready',
  readOnlyOwned = false,
}: {
  initialBoardId?: number | null
  state?: 'ready' | 'empty' | 'error'
  readOnlyOwned?: boolean
}) {
  const [selection, setSelection] = useState<{ boardId: number | null }>({
    boardId: initialBoardId,
  })
  return (
    <AuthContext.Provider value={BOARD_AUTH}>
      <BoardsPage
        key={state}
        enabled
        currentUser={readOnlyOwned ? { ...BOARD_USER, role: 'student' } : BOARD_USER}
        programs={BOARD_PROGRAMS}
        groups={BOARD_GROUPS}
        {...selection}
        onSelectBoard={(boardId) => setSelection({ boardId })}
        onOpenInuksuk={fn()}
      />
    </AuthContext.Provider>
  )
}
const meta = {
  title: 'Components/BoardsPage',
  component: Example,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  beforeEach: ({ args }) => {
    writes.mockClear()
    return installBoardsFetch(
      args.state,
      writes,
      args.readOnlyOwned
        ? [
            BOARDS_FIXTURES[0],
            {
              ...BOARDS_FIXTURES[1],
              owners: [],
              owner_program_id: 1,
              sort_order: 1,
              permissions: { ...BOARDS_FIXTURES[1].permissions, can_edit: false },
            },
            { ...BOARDS_FIXTURES[0], id: 4, name: 'Another editable Board', sort_order: 2 },
          ]
        : BOARDS_FIXTURES,
    )
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
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(
      await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Open Inuksuk: Light through glass' }),
    ).toBeVisible()
  },
}
export const Favourites: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' })
    await userEvent.click(canvas.getByRole('button', { name: 'Favourite' }))
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('menuitemradio', {
        name: 'Favourites only',
      }),
    )
    await userEvent.click(canvas.getByRole('heading', { name: 'Boards & Inuksuks' }))
    await expect(canvas.getByText('Favourites', { exact: true })).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Open Inuksuk: Stone columns' }),
    ).not.toBeInTheDocument()
  },
}
export const ScopeFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Board: Shared discoveries' })
    await userEvent.click(canvas.getByRole('button', { name: 'Scope' }))
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('menuitemcheckbox', {
        name: 'Private',
      }),
    )
    await userEvent.click(canvas.getByRole('heading', { name: 'Boards & Inuksuks' }))
    await expect(
      canvas.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBeVisible()
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
export const ReadOnlyOwnedBoard: Story = {
  args: { readOnlyOwned: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handle = await canvas.findByRole('button', { name: 'Reorder Architecture inspiration' })
    await expect(
      canvas.getByRole('button', { name: 'Open Board: Next studio project' }),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Reorder Next studio project' }),
    ).not.toBeInTheDocument()
    const readOnly = canvas.getByRole('region', { name: 'Boards' })
    await expect(
      within(readOnly).getByRole('button', { name: 'Open Board: Next studio project' }),
    ).toBeVisible()
    handle.focus()
    await userEvent.keyboard('[Space][ArrowRight][Space]')
    await waitFor(() =>
      expect(writes).toHaveBeenCalledWith('/api/boards/order', {
        items: [
          { board_id: 4, version: BOARDS_FIXTURES[0].version },
          { board_id: 1, version: BOARDS_FIXTURES[0].version },
        ],
      }),
    )
    await waitFor(() =>
      expect(
        within(canvas.getByRole('region', { name: 'Boards' })).getAllByRole('button', {
          name: /^Open Board:/,
        })[0],
      ).toHaveAccessibleName('Open Board: Another editable Board'),
    )
    await expect(within(readOnly).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(3)
    await expect(
      within(readOnly).getByRole('button', { name: 'Open Board: Next studio project' }),
    ).toBeVisible()
  },
}

export const CollectionSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Select' }))
    const checkboxes = await canvas.findAllByRole('checkbox', { name: /^Select / })
    await userEvent.click(checkboxes[0])
    await userEvent.click(checkboxes[1])
    const toolbar = canvas.getByRole('toolbar', { name: 'Selected Inuksuks' })
    await expect(
      within(toolbar).getByRole('button', { name: 'Create Sequence Collection' }),
    ).toBeEnabled()
    await expect(
      within(toolbar).getByRole('button', { name: 'Create Synchronized Collection' }),
    ).toBeEnabled()
  },
}

export const SaveToBoard: Story = {
  play: async ({ canvasElement }) => {
    const user = userEvent.setup()
    const canvas = within(canvasElement)
    const handle = await canvas.findByRole('button', { name: 'Drag Rose window' })
    const target = canvas.getByRole('region', { name: 'Save to Next studio project' })
    const sourceRect = handle.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const sourcePoint = {
      clientX: sourceRect.x + sourceRect.width / 2,
      clientY: sourceRect.y + sourceRect.height / 2,
    }
    const targetPoint = {
      clientX: targetRect.x + targetRect.width / 2,
      clientY: targetRect.y + targetRect.height / 2,
    }
    await user.pointer({ keys: '[MouseLeft>]', target: handle, coords: sourcePoint })
    await user.pointer({
      target: handle,
      coords: { ...sourcePoint, clientX: sourcePoint.clientX + 12 },
    })
    await waitFor(() => expect(handle.parentElement).toHaveStyle({ opacity: '0.5' }))
    await user.pointer({ target, coords: targetPoint })
    await waitFor(() => expect(target).toHaveStyle({ outlineWidth: '3px' }))
    await user.pointer({ keys: '[/MouseLeft]', target, coords: targetPoint })
    await waitFor(() =>
      expect(
        writes,
        within(canvasElement.ownerDocument.body).queryByRole('alert')?.textContent ??
          'No page error',
      ).toHaveBeenCalledWith('/api/inuksuks/7', {
        version: 3,
        board_assignments: [{ board_id: 1, sort_order: 0 }, { board_id: 3 }],
      }),
    )
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).getByText('Saved to Next studio project'),
      ).toBeVisible(),
    )
    await waitFor(() => expect(handle.parentElement).toHaveStyle({ opacity: '1' }))
  },
}
