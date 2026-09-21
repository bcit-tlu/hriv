import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ReorderSnackbar from './ReorderSnackbar'

// Portaled Snackbar pinned bottom-right — use fullscreen layout so the snapshot
// includes the whole viewport. Responsive modes come from preview.tsx.
const meta = {
  title: 'Components/ReorderSnackbar',
  component: ReorderSnackbar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Snackbar wrapper around ReorderStatusIndicator that positions save-state readouts ' +
          'in the bottom-right notification stack (offsetIndex controls vertical position).',
      },
    },
  },
  args: {
    offsetIndex: 0,
    onRetry: fn(),
    onAcceptServerOrder: fn(),
    onReapplyLocalOrder: fn(),
    onRetryFailedScopes: fn(),
  },
} satisfies Meta<typeof ReorderSnackbar>

export default meta

type Story = StoryObj<typeof meta>

export const Saving: Story = {
  args: { status: 'saving' },
}

export const Error: Story = {
  args: { status: 'error', serverOrderAvailable: true },
}

export const Stacked: Story = {
  name: 'Stacked (offsetIndex 1)',
  args: { status: 'saved', offsetIndex: 1 },
}
