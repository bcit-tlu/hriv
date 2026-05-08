import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmImportDialog from '../../src/components/ConfirmImportDialog'

describe('ConfirmImportDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  const file = new File(['test'], 'backup.json', { type: 'application/json' })
  Object.defineProperty(file, 'size', { value: 1024 * 500 })

  it('renders db_import title and warning', () => {
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={file}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('Import database?')).toBeInTheDocument()
    expect(screen.getByText(/categories, images, users/)).toBeInTheDocument()
  })

  it('renders files_import title and warning', () => {
    render(
      <ConfirmImportDialog
        open
        kind="files_import"
        file={file}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('Import filesystem?')).toBeInTheDocument()
    expect(screen.getByText(/tiles, thumbnails/)).toBeInTheDocument()
  })

  it('shows file name', () => {
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={file}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('backup.json')).toBeInTheDocument()
  })

  it('proceed button is disabled until checkbox is checked', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={file}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const proceed = screen.getByRole('button', { name: /proceed/i })
    expect(proceed).toBeDisabled()

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)
    expect(proceed).toBeEnabled()
  })

  it('calls onConfirm when proceed is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={file}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /proceed/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={file}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows placeholder when file is null', () => {
    render(
      <ConfirmImportDialog
        open
        kind="db_import"
        file={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('(no file selected)')).toBeInTheDocument()
    // Proceed button should also be disabled
    expect(screen.getByRole('button', { name: /proceed/i })).toBeDisabled()
  })
})
