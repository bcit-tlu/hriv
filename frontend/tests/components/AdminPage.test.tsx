import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPage from '../../src/components/AdminPage'
import * as api from '../../src/api'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/api')
  return {
    ...actual,
    fetchAdminTasks: vi.fn(),
    fetchAdminTask: vi.fn(),
    startDbExport: vi.fn(),
    startDbImport: vi.fn(),
    startFilesExport: vi.fn(),
    initFilesImport: vi.fn(),
    uploadTaskFile: vi.fn(),
    cancelAdminTask: vi.fn(),
    downloadAdminTaskResult: vi.fn(),
  }
})

vi.mock('../../src/components/ChangelogAdmin', () => ({
  default: () => <div>Changelog admin content</div>,
}))

const mockFetchAdminTasks = vi.mocked(api.fetchAdminTasks)

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAdminTasks.mockResolvedValue([])
  })

  it('opens on the changelog tab by default', async () => {
    render(<AdminPage />)

    expect(screen.getByRole('tab', { name: 'Changelog' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Backups' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Changelog admin content')).toBeInTheDocument()

    await waitFor(() => expect(mockFetchAdminTasks).toHaveBeenCalledTimes(1))
  })

  it('shows export actions first and keeps recent tasks collapsed on the backups tab', async () => {
    const user = userEvent.setup()
    mockFetchAdminTasks.mockResolvedValue([
      {
        id: 8,
        task_type: 'files_export',
        status: 'completed',
        progress: 100,
        log: 'done',
        result_filename: 'files-backup.tar.gz',
        error_message: null,
        created_by: 1,
        created_at: '2026-06-19T19:00:00Z',
        updated_at: '2026-06-19T19:02:00Z',
      },
    ])

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(screen.getByRole('heading', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument()
    expect(screen.getByText('Export Database')).toBeInTheDocument()
    expect(screen.getByText('Export Files')).toBeInTheDocument()
    expect(screen.getByText('Import Database')).toBeInTheDocument()
    expect(screen.getByText('Import Files')).toBeInTheDocument()
    const recentTasksToggle = screen.getByRole('button', { name: /Recent Tasks/i })
    expect(recentTasksToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(recentTasksToggle)

    expect(recentTasksToggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Filesystem Export')).toBeVisible()
  })
})
