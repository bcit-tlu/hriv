import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPage from '../../src/components/AdminPage'
import * as api from '../../src/api'

const { mockLogout } = vi.hoisted(() => ({
  mockLogout: vi.fn(),
}))

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

vi.mock('../../src/useAuth', () => ({
  useAuth: () => ({
    logout: mockLogout,
  }),
}))

vi.mock('../../src/components/ChangelogAdmin', () => ({
  default: () => <div>Changelog admin content</div>,
}))

const mockFetchAdminTasks = vi.mocked(api.fetchAdminTasks)
const mockFetchAdminTask = vi.mocked(api.fetchAdminTask)
const mockStartDbExport = vi.mocked(api.startDbExport)
const mockStartDbImport = vi.mocked(api.startDbImport)
const mockStartFilesExport = vi.mocked(api.startFilesExport)
const mockInitFilesImport = vi.mocked(api.initFilesImport)
const mockUploadTaskFile = vi.mocked(api.uploadTaskFile)
const mockCancelAdminTask = vi.mocked(api.cancelAdminTask)
const mockDownloadAdminTaskResult = vi.mocked(api.downloadAdminTaskResult)

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAdminTasks.mockResolvedValue([])
    mockStartDbExport.mockResolvedValue({
      id: 1,
      task_type: 'db_export',
      status: 'pending',
      progress: 0,
      log: '',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockStartDbImport.mockResolvedValue({
      id: 2,
      task_type: 'db_import',
      status: 'pending',
      progress: 0,
      log: '',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockStartFilesExport.mockResolvedValue({
      id: 3,
      task_type: 'files_export',
      status: 'pending',
      progress: 0,
      log: '',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockInitFilesImport.mockResolvedValue({
      id: 4,
      task_type: 'files_import',
      status: 'uploading',
      progress: 0,
      log: 'Awaiting file upload: backup.tar.gz\n',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockUploadTaskFile.mockResolvedValue({
      id: 4,
      task_type: 'files_import',
      status: 'pending',
      progress: 0,
      log: 'Awaiting file upload: backup.tar.gz\nUpload complete (0.0 MB). Queued for processing.\n',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockCancelAdminTask.mockResolvedValue({
      id: 1,
      task_type: 'db_export',
      status: 'cancelled',
      progress: 0,
      log: 'cancelled',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    mockDownloadAdminTaskResult.mockResolvedValue()
    mockFetchAdminTask.mockReset()
    mockLogout.mockClear()
  })

  afterEach(() => {
    // restoreAllMocks() undoes vi.spyOn (e.g. window.confirm) so a spy from
    // one test can't leak into the next; module mocks from vi.mock() are
    // unaffected and re-armed in beforeEach.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens on the changelog tab by default', async () => {
    render(<AdminPage />)

    expect(screen.getByRole('tab', { name: 'Changelog' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Changelog' })).toHaveAttribute(
      'aria-controls',
      'admin-tabpanel-changelog',
    )
    expect(screen.getByRole('tab', { name: 'Backups' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Backups' })).toHaveAttribute(
      'aria-controls',
      'admin-tabpanel-backups',
    )
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

  it('stops polling and shows a session-ended message on 401', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockFetchAdminTask.mockRejectedValue(new api.ApiError(401, 'Unauthorized'))

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])

    // First poll returns 401 → session ended, polling stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(
      screen.getByText(/Your session ended because your account was replaced/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Log back in/i })).toBeInTheDocument()
    expect(mockFetchAdminTask).toHaveBeenCalledTimes(1)

    // Advancing further does not resume polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mockFetchAdminTask).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Log back in/i }))
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('retries polling after a transient network error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockFetchAdminTask
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        id: 1,
        task_type: 'db_export',
        status: 'completed',
        progress: 100,
        log: 'done',
        result_filename: 'files-backup.tar.gz',
        error_message: null,
        created_by: 1,
        created_at: '2026-06-19T19:00:00Z',
        updated_at: '2026-06-19T19:02:00Z',
      })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])

    // Poll #1 fails with a network error → retry scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    // Poll #2 succeeds (task completed) → polling stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(mockFetchAdminTask).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/Your session ended because your account was replaced/i),
    ).not.toBeInTheDocument()
  })

  it('reconciles a force-cancel request that lands after the task is already terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const cancellingTask = {
      id: 3,
      task_type: 'files_export' as const,
      status: 'cancelling' as const,
      progress: 62,
      log: 'Cancellation requested by admin.\n',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:00:00Z',
      updated_at: '2026-06-19T19:01:00Z',
    }
    const cancelledTask = {
      ...cancellingTask,
      status: 'cancelled' as const,
      log: 'Cancelled before cleanup completed.\n',
      updated_at: '2026-06-19T19:01:10Z',
    }
    // Defensive coverage: the current backend returns 200 (no-op) when
    // cancelling an already-terminal task, so this exact 400 no longer occurs
    // on the happy path. We still exercise handleCancel's reconcile-on-failure
    // branch, which must recover for any non-2xx cancel response (a 500, a
    // network error, or an older backend). The task only flips to terminal once
    // the (failed) cancel request lands, so background polls keep the Force
    // cancel affordance visible until then.
    let cancelRequested = false
    mockFetchAdminTask.mockImplementation(async () =>
      cancelRequested ? cancelledTask : cancellingTask,
    )
    mockCancelAdminTask.mockImplementation(async () => {
      cancelRequested = true
      throw new api.ApiError(400, "Cannot cancel task in 'cancelled' state")
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[1])

    // Poll returns 'cancelling' → the Force cancel affordance appears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const forceCancel = screen.getByRole('button', { name: 'Force cancel' })
    // The cancel API rejects (task already terminal); handleCancel reconciles
    // by re-fetching and finalizing the task.
    await user.click(forceCancel)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Force cancel' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText(/Failed to force-cancel task/)).not.toBeInTheDocument()
    expect(mockCancelAdminTask).toHaveBeenCalledTimes(1)
  })

  it('shows the session-ended message when a cancel request returns 401', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // Poll keeps the task in a cancellable state; the cancel request itself
    // fails with a 401 because the acting account was replaced by an import.
    mockFetchAdminTask.mockResolvedValue({
      id: 3,
      task_type: 'files_export',
      status: 'cancelling',
      progress: 62,
      log: 'Cancellation requested by admin.\n',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:00:00Z',
      updated_at: '2026-06-19T19:01:00Z',
    })
    mockCancelAdminTask.mockRejectedValue(new api.ApiError(401, 'Unauthorized'))

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[1])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await user.click(screen.getByRole('button', { name: 'Force cancel' }))

    expect(
      await screen.findByText(/Your session ended because your account was replaced/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Failed to force-cancel task/)).not.toBeInTheDocument()
  })
})
