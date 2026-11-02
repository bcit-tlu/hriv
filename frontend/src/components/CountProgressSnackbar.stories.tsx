import type { Meta, StoryObj } from '@storybook/react-vite'

import CountProgressSnackbar from './CountProgressSnackbar'
import type { SelectionCountEntry } from '../useSelectionCounts'

const SELECTION = { x: 0, y: 0, width: 10, height: 10 }

function entry(partial: Partial<SelectionCountEntry>): SelectionCountEntry {
  return {
    key: 'sel-1',
    label: 'Selection 2',
    mode: 'cells',
    selection: SELECTION,
    phase: 'running',
    queuePosition: null,
    jobId: 'j1',
    ...partial,
  }
}

const meta = {
  title: 'Components/CountProgressSnackbar',
  component: CountProgressSnackbar,
  args: {
    onCancelActive: () => {},
    onDismissError: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof CountProgressSnackbar>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { activeEntries: [entry({})], errorEntry: null },
}

export const Queued: Story = {
  args: {
    activeEntries: [entry({ phase: 'queued', queuePosition: 3 })],
    errorEntry: null,
  },
}

export const ErrorNotice: Story = {
  args: {
    activeEntries: [],
    errorEntry: entry({ phase: 'failed', error: 'too_large' }),
  },
}
