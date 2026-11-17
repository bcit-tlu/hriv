import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardsPage from './BoardsPage'
import {
  BOARD_AUTH,
  BOARD_DISCOVERY_FIXTURES,
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
  role = BOARD_USER.role,
}: {
  initialBoardId?: number | null
  state?: 'ready' | 'empty' | 'error'
  readOnlyOwned?: boolean
  role?: typeof BOARD_USER.role
  discoveryFixtures?: boolean
}) {
  const [selection, setSelection] = useState<{ boardId: number | null }>({
    boardId: initialBoardId,
  })
  const currentUser = { ...BOARD_USER, role: readOnlyOwned ? ('student' as const) : role }
  return (
    <AuthContext.Provider value={{ ...BOARD_AUTH, currentUser }}>
      <BoardsPage
        key={state}
        enabled
        currentUser={currentUser}
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
        : args.discoveryFixtures
          ? BOARD_DISCOVERY_FIXTURES.filter(
              (board) =>
                args.role !== 'student' ||
                board.visibility !== 'private' ||
                board.owners.some((owner) => owner.user_id === BOARD_USER.id),
            )
          : BOARDS_FIXTURES,
    )
  },
} satisfies Meta<typeof Example>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'My Boards', level: 1 })).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Open Board: Architecture inspiration' }),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' }),
    ).toBeVisible()
    await expect(
      canvas
        .getAllByRole('button', { name: /^Open Inuksuk:/ })
        .map((el) => el.getAttribute('aria-label')?.replace('Open Inuksuk: ', '')),
    ).toEqual([
      'A study in geometry',
      'Light through glass',
      'Rose window',
      'Stone columns',
      'The arcade',
      'Tracery details',
    ])
  },
}
export const Table: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' })
    await userEvent.click(canvas.getByRole('button', { name: 'Table view' }))
    await expect(canvas.getByRole('table', { name: 'Inuksuks' })).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Boards' })).toBeVisible()
    await expect(
      within(canvas.getByRole('region', { name: 'Filter Boards and Inuksuks' })).getByRole(
        'button',
        { name: 'Select' },
      ),
    ).toHaveClass(/MuiButton-outlined/)
  },
}
export const SelectedBoard: Story = {
  args: { initialBoardId: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    const dialog = await canvas.findByRole('dialog', { name: 'Architecture inspiration' })
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Open Inuksuk: Rose window' }),
      ).toBeVisible(),
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Open Inuksuk: Light through glass' }),
      ).toBeVisible(),
    )
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
    await userEvent.click(canvas.getByRole('heading', { name: 'My Boards' }))
    await expect(canvas.getByText('Favourites', { exact: true })).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Open Inuksuk: Stone columns' }),
    ).not.toBeInTheDocument()
  },
}
export const ScopeFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Open Board: Architecture inspiration' })
    await userEvent.click(canvas.getByRole('button', { name: 'Scope' }))
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('menuitemcheckbox', {
        name: 'Private',
      }),
    )
    await userEvent.click(canvas.getByRole('heading', { name: 'My Boards' }))
    await expect(
      canvas.queryByRole('button', { name: 'Open Board: Shared discoveries' }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Open Inuksuk: Rose window' })).toBeVisible()
  },
}
export const PublicSharedBoards: Story = {
  args: { role: 'admin', discoveryFixtures: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Public & shared Boards' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Public & shared Boards',
    })
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Open Board: Shared discoveries' }),
      ).toBeVisible(),
    )
    await expect(within(dialog).getByText('Managed by Morgan')).toBeVisible()
    await expect(within(dialog).getByText('Managed by program Engineering')).toBeVisible()
    await expect(
      within(dialog).queryByRole('button', { name: 'Open Board: Morgan’s private studies' }),
    ).not.toBeInTheDocument()
  },
}
export const StudentPublicSharedBoards: Story = {
  args: { role: 'student', discoveryFixtures: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'All Boards' })).not.toBeInTheDocument()
    await userEvent.click(await canvas.findByRole('button', { name: 'Public & shared Boards' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Public & shared Boards',
    })
    await waitFor(() => expect(within(dialog).getByText('Managed by Morgan')).toBeVisible())
    await expect(within(dialog).getByText('Managed by program Engineering')).toBeVisible()
    await expect(
      within(dialog).queryByRole('button', { name: 'Open Board: Morgan’s private studies' }),
    ).not.toBeInTheDocument()
  },
}
export const AllBoards: Story = {
  args: { role: 'admin', discoveryFixtures: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'All Boards' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'All Boards',
    })
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Open Board: Morgan’s private studies' }),
      ).toBeVisible(),
    )
    await expect(within(dialog).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(
      BOARD_DISCOVERY_FIXTURES.length,
    )
    await expect(within(dialog).getByText('Managed by program Engineering')).toBeVisible()
  },
}
export const Empty: Story = { args: { state: 'empty' } }
export const ErrorState: Story = { args: { state: 'error' } }

async function expectHorizontalBoardChips(row: HTMLElement) {
  await waitFor(async () => {
    const chips = within(row).getAllByRole('group')
    await expect(Array.from(row.children).slice(1)).toEqual(chips)
    const bounds = chips.map((chip) => chip.getBoundingClientRect())
    await expect(bounds[0].height).toBeGreaterThan(0)
    for (let i = 1; i < bounds.length; i++) {
      await expect(Math.abs(bounds[i].top - bounds[0].top)).toBeLessThan(1)
      await expect(Math.abs(bounds[i].height - bounds[0].height)).toBeLessThan(1)
      await expect(bounds[i].left).toBeGreaterThanOrEqual(bounds[i - 1].right)
    }
  })
}

export const KeyboardReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handle = await canvas.findByRole('group', { name: 'Architecture inspiration' })
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
    await expectHorizontalBoardChips(canvas.getByRole('region', { name: 'Boards' }))
  },
}
export const ReadOnlyOwnedBoard: Story = {
  args: { readOnlyOwned: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handle = await canvas.findByRole('group', { name: 'Architecture inspiration' })
    await expect(
      canvas.queryByRole('button', { name: 'Open Board: Next studio project' }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: 'Reorder Next studio project' }),
    ).not.toBeInTheDocument()
    const readOnly = canvas.getByRole('region', { name: 'Boards' })
    await expect(
      within(readOnly).queryByRole('region', { name: 'Save to Next studio project' }),
    ).not.toBeInTheDocument()
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
    await expect(within(readOnly).getAllByRole('button', { name: /^Open Board:/ })).toHaveLength(2)
    await expectHorizontalBoardChips(readOnly)
    await userEvent.click(canvas.getByRole('button', { name: 'Public & shared Boards' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Public & shared Boards',
    })
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Open Board: Next studio project' }),
      ).toBeVisible(),
    )
  },
}

function rejectedDrop(name: string, message: string): NonNullable<Story['play']> {
  return async ({ canvasElement, userEvent: user }) => {
    const canvas = within(canvasElement)
    const source = (
      await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' })
    ).closest('[data-testid="inuksuk-card"]')!.parentElement!
    const target = canvas.getByRole('region', { name: `Save to ${name}` })
    const s = source.getBoundingClientRect()
    const t = target.getBoundingClientRect()
    const start = { clientX: s.x + s.width / 2, clientY: s.y + s.height / 2 }
    await user.pointer({ keys: '[MouseLeft>]', target: source, coords: start })
    await user.pointer({ target: source, coords: { ...start, clientX: start.clientX + 12 } })
    await waitFor(() => expect(source).toHaveStyle({ opacity: '0.5' }))
    const end = { clientX: t.x + t.width / 2, clientY: t.y + t.height / 2 }
    await user.pointer({ target, coords: end })
    await expect(target).not.toHaveStyle({ outlineStyle: 'solid' })
    await user.pointer({ keys: '[/MouseLeft]', target, coords: end })
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText(message)).toBeVisible(),
    )
    await waitFor(() => expect(source).toHaveStyle({ opacity: '1' }))
    await expect(writes).not.toHaveBeenCalled()
  }
}
export const AlreadyLinkedDrop: Story = {
  play: rejectedDrop('Architecture inspiration', 'Already in Architecture inspiration'),
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
    const handle = (
      await canvas.findByRole('button', { name: 'Open Inuksuk: Rose window' })
    ).closest('[data-testid="inuksuk-card"]')!.parentElement!
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
    await waitFor(() => expect(handle).toHaveStyle({ opacity: '0.5' }))
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
    await waitFor(() => expect(handle).toHaveStyle({ opacity: '1' }))
  },
}
