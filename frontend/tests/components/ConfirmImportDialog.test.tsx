/**
 * Unit tests for ConfirmImportDialog (P18).
 *
 * The dialog guards the destructive admin import operations (DB and
 * filesystem) behind an explicit "I have verified a recent backup
 * exists" confirmation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmImportDialog, {
  type ConfirmImportKind,
} from '../../src/components/ConfirmImportDialog'

function makeFile(name = 'snapshot.tar.gz', size = 2 * 1024 * 1024) {
  const file = new File(['x'.repeat(32)], name, {
    type: 'application/gzip',
  })
  // Force a specific reported size for the byte formatter.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function renderDialog(
  overrides: Partial<Parameters<typeof ConfirmImportDialog>[0]> = {},
) {
  const onCancel = overrides.onCancel ?? vi.fn()
  const onConfirm = overrides.onConfirm ?? vi.fn()
  // ``??`` would overwrite ``file: null`` (which is a valid prop value)
  // with the default — check explicit presence instead.
  const file = 'file' in overrides ? overrides.file! : makeFile()
  const result = render(
    <ConfirmImportDialog
      open={overrides.open ?? true}
      kind={overrides.kind ?? 'files_import'}
      file={file}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )
  return { ...result, onCancel, onConfirm }
}

function getConfirmButton() {
  return screen.getByRole('button', { name: /I understand, proceed/i })
}

function getCancelButton() {
  return screen.getByRole('button', { name: /^Cancel$/ })
}

function getBackupCheckbox() {
  return screen.getByRole('checkbox', {
    name: /I have verified a recent backup exists/i,
  })
}

describe('ConfirmImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the db_import title and copy', () => {
    renderDialog({ kind: 'db_import' })
    expect(
      screen.getByRole('heading', { name: /import database\?/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /all categories, images, users, and source image records/i,
      ),
    ).toBeInTheDocument()
  })

  it('renders the files_import title and copy', () => {
    renderDialog({ kind: 'files_import' })
    expect(
      screen.getByRole('heading', { name: /import filesystem\?/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /all image tiles, thumbnails, and uploaded source files/i,
      ),
    ).toBeInTheDocument()
  })

  it('shows the selected archive filename and a human-readable size', () => {
    renderDialog({ file: makeFile('backup-2026-04-18.tar.gz', 2 * 1024 * 1024) })
    expect(screen.getByText('backup-2026-04-18.tar.gz')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
  })

  it.each<[number, string]>([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [10189, '10 KB'], // under 10 → round to 10, then no decimal
    [1048064, '1.0 MB'], // near KB→MB boundary, must promote
    [1048575, '1.0 MB'], // just below 1 MiB, must promote
    [1048576, '1.0 MB'],
    [2 * 1024 * 1024, '2.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('formats %d bytes as %s', (size, expected) => {
    renderDialog({ file: makeFile('x', size) })
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('keeps the confirm button disabled until the backup checkbox is ticked', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(getConfirmButton()).toBeDisabled()
    await user.click(getBackupCheckbox())
    expect(getConfirmButton()).toBeEnabled()
  })

  it('re-ticking does not permanently enable after closing and reopening', () => {
    // Simulate the parent toggling ``open`` between imports — the
    // checkbox must reset so the admin affirms each time.
    const { rerender } = renderDialog({ open: true })
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    rerender(
      <ConfirmImportDialog
        open={false}
        kind="files_import"
        file={makeFile()}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    rerender(
      <ConfirmImportDialog
        open={true}
        kind="files_import"
        file={makeFile()}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(getBackupCheckbox()).not.toBeChecked()
    expect(getConfirmButton()).toBeDisabled()
  })

  it('calls onConfirm when the user confirms after ticking the checkbox', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()
    await user.click(getBackupCheckbox())
    await user.click(getConfirmButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not call onConfirm when the confirm button is clicked while disabled', () => {
    const { onConfirm } = renderDialog()
    // ``userEvent.click`` refuses to click elements with
    // ``pointer-events: none`` (MUI's disabled styling), so we use
    // ``fireEvent.click`` to confirm the React handler still refuses
    // to fire when the button is in the disabled state.
    fireEvent.click(getConfirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel, onConfirm } = renderDialog()
    await user.click(getCancelButton())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables confirm when file is null', async () => {
    const user = userEvent.setup()
    renderDialog({ file: null })
    await user.click(getBackupCheckbox())
    expect(getConfirmButton()).toBeDisabled()
  })

  it.each<[ConfirmImportKind]>([['db_import'], ['files_import']])(
    'shows the same warning severity for %s',
    (kind) => {
      renderDialog({ kind })
      // The MUI Alert renders role="alert" with a matching class for the severity.
      const alert = screen.getByRole('alert')
      expect(alert.className).toMatch(/MuiAlert-standardWarning/)
    },
  )
})
