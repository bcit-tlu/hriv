import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'

type ColKey = 'name' | 'copyright' | 'uploaded' | 'size' | 'visibility'

const COLUMNS: readonly ColumnVisibilityOption<ColKey>[] = [
  { key: 'name', label: 'Name' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'size', label: 'File size' },
  { key: 'visibility', label: 'Visibility' },
]

// Stateful wrapper so toggling checkboxes works in the UI; the dialog is a
// controlled component. Dialogs render fullscreen at the mobile viewport, which
// the inherited responsive modes capture automatically.
function ColumnVisibilityDialogExample({
  initial,
  minimumVisibleColumns,
}: {
  initial: Record<ColKey, boolean>
  minimumVisibleColumns?: number
}) {
  const [visible, setVisible] = useState(initial)
  return (
    <ColumnVisibilityDialog
      open
      title="Show columns"
      columns={COLUMNS}
      visibleColumns={visible}
      minimumVisibleColumns={minimumVisibleColumns}
      onClose={fn()}
      onToggleColumn={(key) => setVisible((v) => ({ ...v, [key]: !v[key] }))}
    />
  )
}

const meta = {
  title: 'Components/ColumnVisibilityDialog',
  component: ColumnVisibilityDialogExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Generic column show/hide dialog for data tables. Prevents dropping below a ' +
          'configurable minimum number of visible columns by disabling the last checkbox.',
      },
    },
  },
} satisfies Meta<typeof ColumnVisibilityDialogExample>

export default meta

type Story = StoryObj<typeof meta>

export const AllVisible: Story = {
  name: 'All Visible',
  args: {
    initial: { name: true, copyright: true, uploaded: true, size: true, visibility: true },
  },
}

export const SomeHidden: Story = {
  name: 'Some Hidden',
  args: {
    initial: { name: true, copyright: false, uploaded: true, size: false, visibility: true },
  },
}

export const MinimumReached: Story = {
  name: 'Minimum Reached (last one disabled)',
  args: {
    initial: { name: true, copyright: false, uploaded: false, size: false, visibility: false },
    minimumVisibleColumns: 1,
  },
}
