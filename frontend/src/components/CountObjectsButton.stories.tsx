import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'

import CountObjectsButton from './CountObjectsButton'
import type { SelectionCountEntry } from '../useSelectionCounts'

const SELECTION = { x: 0, y: 0, width: 10, height: 10 }

function entry(partial: Partial<SelectionCountEntry>): SelectionCountEntry {
  return {
    key: 'sel-1',
    label: 'Selection 2',
    mode: 'cells',
    selection: SELECTION,
    phase: 'queued',
    queuePosition: null,
    jobId: 'j1',
    ...partial,
  }
}

const meta = {
  title: 'Components/CountObjectsButton',
  component: CountObjectsButton,
  decorators: [
    (Story) => (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'flex-end' }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    selectionIndex: 2,
    onCount: () => {},
    onCancel: () => {},
    onViewResults: () => {},
  },
} satisfies Meta<typeof CountObjectsButton>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Count objects in selection 2' }))
    const menu = await within(canvasElement.ownerDocument.body).findByRole('menuitem', {
      name: /Objects/,
    })
    await expect(menu).toBeInTheDocument()
  },
}

export const Counting: Story = {
  args: { entry: entry({ phase: 'queued', queuePosition: 3 }) },
}

export const Done: Story = {
  args: {
    entry: entry({
      phase: 'done',
      result: { total: 77, groups: [], objects: [], preview: null },
    }),
  },
}
