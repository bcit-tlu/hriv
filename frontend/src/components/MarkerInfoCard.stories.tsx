import { useState } from 'react'
import Box from '@mui/material/Box'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within, userEvent, waitFor } from 'storybook/test'
import MarkerInfoCard from './MarkerInfoCard'
import { BOARD_FIXTURE, MARKER_FIXTURE } from './markerFixtures'

function Card({ editable = true, favourite = true }: { editable?: boolean; favourite?: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  return (
    <Box
      ref={setContainer}
      sx={{ height: 560, position: 'relative', background: 'url(/hriv-splash2.jpg) center/cover' }}
    >
      {container && (
        <MarkerInfoCard
          item={{
            ...MARKER_FIXTURE,
            favourite,
            permissions: { can_edit: editable, can_delete: editable },
          }}
          container={container}
          onClose={() => {}}
          onEdit={() => setEditing(true)}
          editing={editing}
          onCancelEdit={() => setEditing(false)}
        />
      )}
    </Box>
  )
}
const meta = {
  title: 'Components/MarkerInfoCard',
  component: Card,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    const original = globalThis.fetch
    let item = { ...MARKER_FIXTURE }
    globalThis.fetch = async (input, init) => {
      const path = String(input)
      if (path.includes('/api/boards/')) return Response.json(BOARD_FIXTURE)
      if (path.includes('/api/boards')) return Response.json([BOARD_FIXTURE])
      if (path.includes('/api/markers/')) {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as { favourite: boolean }
          item = { ...item, favourite: body.favourite, version: item.version + 1 }
        }
        return Response.json(item)
      }
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(
      canvas.getByRole('heading', { name: 'Rose window' }).previousElementSibling,
    ).toHaveAttribute('data-testid', 'RoomIcon')
    await expect(
      canvas.queryByRole('button', { name: 'Close Marker information' }),
    ).not.toBeInTheDocument()
    await expect(canvas.queryByText('Favourite', { exact: true })).not.toBeInTheDocument()
    await expect(await within(canvasElement).findByText(BOARD_FIXTURE.name)).toBeVisible()
    await expect(
      within(canvasElement).getByRole('button', { name: 'Edit Rose window' }),
    ).toBeVisible()
  },
}
export const ReadOnly: Story = {
  args: { editable: false, favourite: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Not favourited' })).toBeVisible()
    await expect(canvas.queryByText('Not a favourite')).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Edit Rose window' })).not.toBeInTheDocument()
  },
}
export const InlineEdit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit Rose window' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled())
    await expect(canvas.getByRole('textbox', { name: 'Description' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('form', { name: 'Edit Marker' })).toBeVisible()
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
export const DeleteConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit Rose window' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled())
    await userEvent.click(canvas.getByRole('button', { name: 'Delete Marker' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Delete Marker?',
    })
    await waitFor(() => expect(dialog).toBeVisible())
    await expect(within(dialog).getByText(/permanently deleted from all its Boards/)).toBeVisible()
  },
}
