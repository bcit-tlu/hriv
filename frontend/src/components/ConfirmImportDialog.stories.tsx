import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ConfirmImportDialog from './ConfirmImportDialog'

const dbFile = new File(['x'], 'hriv-backup-2026-09-21.db')
const zipFile = new File(['x'], 'source-images-2026-09-21.zip')

// Fullscreen layout for the portaled Dialog; responsive modes from preview.tsx.
const meta = {
  title: 'Components/ConfirmImportDialog',
  component: ConfirmImportDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Destructive-action confirmation shown before importing a database dump or an image ' +
          'archive, spelling out exactly what the import replaces.',
      },
    },
  },
  args: { open: true, onCancel: fn(), onConfirm: fn() },
} satisfies Meta<typeof ConfirmImportDialog>

export default meta

type Story = StoryObj<typeof meta>

export const DatabaseImport: Story = {
  name: 'Database Import',
  args: { kind: 'db_import', file: dbFile },
}

export const FilesImport: Story = {
  name: 'Files Import',
  args: { kind: 'files_import', file: zipFile },
}
