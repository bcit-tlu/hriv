import { useState } from 'react'
import Box from '@mui/material/Box'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import InuksukInfoCard from './InuksukInfoCard'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from './inuksukFixtures'

function Card({ editable = true, favourite = true }: { editable?: boolean; favourite?: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <Box
      ref={setContainer}
      sx={{ height: 560, position: 'relative', background: 'url(/hriv-splash2.jpg) center/cover' }}
    >
      {container && (
        <InuksukInfoCard
          item={{
            ...INUKSUK_FIXTURE,
            favourite,
            permissions: { can_edit: editable, can_delete: editable },
          }}
          container={container}
          onClose={() => {}}
          onEdit={() => {}}
        />
      )}
    </Box>
  )
}
const meta = {
  title: 'Components/InuksukInfoCard',
  component: Card,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) =>
      String(input).includes('/api/boards') ? Response.json([BOARD_FIXTURE]) : original(input, init)
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
    await expect(canvas.getByRole('img', { name: 'Favourite' })).toBeVisible()
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
