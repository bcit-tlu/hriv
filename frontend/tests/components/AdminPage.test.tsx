import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPage from '../../src/components/AdminPage'
import { emitEvent } from '../../src/observability'
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
    startRebuildTiles: vi.fn(),
    listBackupSnapshots: vi.fn(),
    fetchBackupSnapshotManifest: vi.fn(),
    fetchFilesImportArchives: vi.fn(),
    fetchFilesImportArchiveRetention: vi.fn(),
    listExportArchives: vi.fn(),
    purgeExportArchive: vi.fn(),
    startFileRestore: vi.fn(),
    initFilesImport: vi.fn(),
    uploadTaskFile: vi.fn(),
    rerunFilesImportArchive: vi.fn(),
    deleteFilesImportArchive: vi.fn(),
    cancelAdminTask: vi.fn(),
    downloadAdminTaskResult: vi.fn(),
    listJobs: vi.fn(),
    fetchRebuildTilesCapability: vi.fn(),
    startParallelRebuildTiles: vi.fn(),
    fetchJobItems: vi.fn(),
    cancelJob: vi.fn(),
    retryJobItem: vi.fn(),
    retryFailedJobItems: vi.fn(),
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

vi.mock('../../src/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/observability')>()),
  emitEvent: vi.fn(),
}))

const mockFetchAdminTasks = vi.mocked(api.fetchAdminTasks)
const mockFetchAdminTask = vi.mocked(api.fetchAdminTask)
const mockStartDbExport = vi.mocked(api.startDbExport)
const mockStartDbImport = vi.mocked(api.startDbImport)
const mockStartFilesExport = vi.mocked(api.startFilesExport)
const mockStartRebuildTiles = vi.mocked(api.startRebuildTiles)
const mockListBackupSnapshots = vi.mocked(api.listBackupSnapshots)
const mockFetchBackupSnapshotManifest = vi.mocked(api.fetchBackupSnapshotManifest)
const mockFetchFilesImportArchives = vi.mocked(api.fetchFilesImportArchives)
const mockFetchFilesImportArchiveRetention = vi.mocked(api.fetchFilesImportArchiveRetention)
const mockListExportArchives = vi.mocked(api.listExportArchives)
const mockPurgeExportArchive = vi.mocked(api.purgeExportArchive)
const mockStartFileRestore = vi.mocked(api.startFileRestore)
const mockInitFilesImport = vi.mocked(api.initFilesImport)
const mockUploadTaskFile = vi.mocked(api.uploadTaskFile)
const mockRerunFilesImportArchive = vi.mocked(api.rerunFilesImportArchive)
const mockDeleteFilesImportArchive = vi.mocked(api.deleteFilesImportArchive)
const mockCancelAdminTask = vi.mocked(api.cancelAdminTask)
const mockDownloadAdminTaskResult = vi.mocked(api.downloadAdminTaskResult)
const mockListJobs = vi.mocked(api.listJobs)
const mockFetchRebuildTilesCapability = vi.mocked(api.fetchRebuildTilesCapability)
const mockStartParallelRebuildTiles = vi.mocked(api.startParallelRebuildTiles)
const mockFetchJobItems = vi.mocked(api.fetchJobItems)
const mockCancelJob = vi.mocked(api.cancelJob)
const mockRetryJobItem = vi.mocked(api.retryJobItem)
const mockRetryFailedJobItems = vi.mocked(api.retryFailedJobItems)

const rebuildJob = (overrides: Partial<api.ApiJob> = {}): api.ApiJob => ({
  id: 7,
  job_type: 'rebuild_tiles',
  status: 'running',
  progress: 40,
  total_count: 10,
  completed_count: 4,
  failed_count: 1,
  skipped_count: 0,
  cancelled_count: 0,
  queued_count: 4,
  running_count: 1,
  error_message: null,
  metadata_extra: { scope: 'missing_stale' },
  requested_by: 1,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const failedItem = (id: number, overrides: Partial<api.ApiJobItem> = {}): api.ApiJobItem => ({
  id,
  job_id: 7,
  resource_type: 'source_image',
  resource_id: String(100 + id),
  status: 'failed',
  attempts: 2,
  progress: 0,
  error_message: 'operational error',
  heartbeat_at: null,
  lease_expires_at: null,
  retry_not_before: null,
  arq_job_id: null,
  metadata_extra: { image_id: 100 + id },
  started_at: null,
  completed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAdminTasks.mockResolvedValue([])
    mockListBackupSnapshots.mockResolvedValue([])
    mockFetchFilesImportArchives.mockResolvedValue([])
    mockFetchFilesImportArchiveRetention.mockResolvedValue({
      retention_count: 0,
      retention_days: 0,
    })
    mockListExportArchives.mockResolvedValue({ archives: [], total_size_bytes: 0 })
    mockPurgeExportArchive.mockResolvedValue({
      deleted: true,
      task_id: 1,
      artifact_role: 'result',
      size_bytes: 0,
    })
    mockFetchBackupSnapshotManifest.mockResolvedValue({
      snapshot_name: 'hriv-backup-20260102-020000',
      created_at: '2026-01-02T02:00:00Z',
      files: {},
    })
    mockStartFileRestore.mockResolvedValue({
      id: 5,
      task_type: 'file_restore',
      status: 'pending',
      progress: 0,
      log: '',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
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
    mockStartRebuildTiles.mockResolvedValue({
      id: 6,
      task_type: 'rebuild_tiles',
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
    // Durable jobs (#1191): empty list + capability off by default keeps
    // existing tests on the serial rebuild path.
    mockListJobs.mockResolvedValue([])
    mockFetchRebuildTilesCapability.mockResolvedValue({
      enabled: false,
      parallelism: 2,
    })
    mockFetchJobItems.mockResolvedValue({ items: [], next_after_id: null })
    mockRerunFilesImportArchive.mockReset()
    mockDeleteFilesImportArchive.mockReset()
    mockFetchAdminTask.mockReset()
    mockLogout.mockClear()
    vi.mocked(emitEvent).mockClear()
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

  it('emits a page-hit telemetry event per shown tab', async () => {
    const user = userEvent.setup()
    render(<AdminPage />)

    await waitFor(() => expect(mockFetchAdminTasks).toHaveBeenCalled())
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'navigation.page_changed',
        action: 'navigate_admin_tab',
        page: 'admin',
        admin_tab: 'changelog',
      }),
    )

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'navigate_admin_tab', admin_tab: 'backups' }),
    )
  })

  it('groups data-transfer cards together and keeps recent tasks collapsed on the backups tab', async () => {
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

    expect(screen.getByText('Export Database')).toBeInTheDocument()
    expect(screen.getByText('Export Files')).toBeInTheDocument()
    expect(screen.getByText('Import Database')).toBeInTheDocument()
    expect(screen.getByText('Import Files')).toBeInTheDocument()
    const recentTasksToggle = screen.getByRole('button', { name: /Recent Tasks/i })

    // Documented layout order: transfer cards, restore panel, recent tasks,
    // then the archive-history panels (docs/ui-behaviour-spec.md).
    const precedes = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const restoreHeading = screen.getByRole('heading', { name: 'Restore individual file' })
    expect(precedes(screen.getByText('Import Files'), restoreHeading)).toBe(true)
    expect(precedes(restoreHeading, recentTasksToggle)).toBe(true)
    expect(
      precedes(recentTasksToggle, screen.getByRole('heading', { name: 'Stored export archives' })),
    ).toBe(true)
    expect(
      precedes(
        screen.getByRole('heading', { name: 'Stored export archives' }),
        screen.getByRole('heading', { name: 'Previously uploaded import archives' }),
      ),
    ).toBe(true)
    expect(recentTasksToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(recentTasksToggle)

    expect(recentTasksToggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Filesystem Export')).toBeVisible()
  })

  it('kicks off a tile rebuild when the Rebuild Tiles button is clicked', async () => {
    const user = userEvent.setup()

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getByTestId('rebuild-tiles-button'))

    await waitFor(() => expect(mockStartRebuildTiles).toHaveBeenCalledTimes(1))
    expect(mockStartRebuildTiles).toHaveBeenCalledWith()
  })

  it('browses a snapshot, restores one file, and surfaces the final task log', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockListBackupSnapshots.mockResolvedValue([
      {
        name: 'hriv-backup-20260102-020000',
        blob_name: 'hriv-backups/hriv-backup-20260102-020000.tar.gz',
        size: 2048,
        created_at: '2026-01-02T02:00:00Z',
      },
    ])
    mockFetchBackupSnapshotManifest.mockResolvedValue({
      snapshot_name: 'hriv-backup-20260102-020000',
      created_at: '2026-01-02T02:00:00Z',
      files: {
        'data/source_images/a.jpg': {
          size: 1024,
          sha256: 'abcdef1234567890deadbeef',
        },
        'data/source_images/b.jpg': {
          size: 512,
          sha256: 'feedfacecafebabe00112233',
        },
      },
    })
    mockStartFileRestore.mockResolvedValue({
      id: 9,
      task_type: 'file_restore',
      status: 'pending',
      progress: 0,
      log: '',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:00:00Z',
      updated_at: '2026-06-19T19:00:00Z',
    })
    mockFetchAdminTask.mockResolvedValue({
      id: 9,
      task_type: 'file_restore',
      status: 'completed',
      progress: 100,
      log: 'Restored data/source_images/a.jpg from hriv-backup-20260102-020000.\nIf this is a source image, run Rebuild Tiles if its tiles are stale.\n',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:00:00Z',
      updated_at: '2026-06-19T19:01:00Z',
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    const snapshotPicker = await screen.findByRole('combobox', { name: 'Snapshot' })
    await user.click(snapshotPicker)
    await user.click(await screen.findByRole('option', { name: /hriv-backup-20260102-020000/i }))

    await screen.findByText('data/source_images/a.jpg')
    const filter = screen.getByRole('textbox', { name: 'Filter files' })
    await user.type(filter, 'a.jpg')
    await user.click(screen.getByText('data/source_images/a.jpg'))

    await user.click(screen.getByRole('button', { name: 'Restore selected file' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm file restore' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mockStartFileRestore).toHaveBeenCalledWith({
      snapshot_name: 'hriv-backup-20260102-020000',
      member_path: 'data/source_images/a.jpg',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    const detailsButton = await screen.findByRole('button', { name: 'Details' })
    await user.click(detailsButton)
    expect(await screen.findByText(/Rebuild Tiles if its tiles are stale/)).toBeInTheDocument()
  }, 30_000)

  it('renders the restore panel in a dormant state when backup restore is not configured', async () => {
    const user = userEvent.setup()
    mockListBackupSnapshots.mockRejectedValue(
      new api.ApiError(400, 'backup restore is not configured'),
    )

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(
      await screen.findByText(/Backup restore is not configured yet in this environment/i),
    ).toBeInTheDocument()
    const snapshotPicker = screen.getByRole('combobox', { name: 'Snapshot' })
    expect(snapshotPicker).toHaveAttribute('aria-disabled', 'true')
    expect(mockFetchBackupSnapshotManifest).not.toHaveBeenCalled()
  })

  it('shows determinate filesystem-import progress and the backend status line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockFetchAdminTask.mockResolvedValue({
      id: 4,
      task_type: 'files_import',
      status: 'running',
      progress: 42,
      log: 'Streaming archive to staging…\nread 12 GiB / 29 GiB archive bytes\n',
      original_filename: 'backup.tar.gz',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    const filesImportInput = screen.getByTestId('files-import-input') as HTMLInputElement
    await user.upload(
      filesImportInput,
      new File(['archive'], 'backup.tar.gz', { type: 'application/gzip' }),
    )
    expect(await screen.findByRole('dialog', { name: 'Import filesystem?' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('checkbox', { name: /I have verified a recent backup exists/i }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'I understand, proceed' })).toBeEnabled(),
    )
    await user.click(await screen.findByRole('button', { name: 'I understand, proceed' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import filesystem?' })).not.toBeInTheDocument(),
    )

    expect(await screen.findByText(/Uploading 0%/)).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar', { hidden: true }).length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(await screen.findByText(/read 12 GiB \/ 29 GiB archive bytes/i)).toBeInTheDocument()
    const progressbars = screen.getAllByRole('progressbar')
    expect(progressbars.some((bar) => bar.getAttribute('aria-valuenow') === '42')).toBe(true)
  })

  it('surfaces the filesystem-import failure reason instead of a generic toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockFetchAdminTask.mockResolvedValue({
      id: 4,
      task_type: 'files_import',
      status: 'failed',
      progress: 100,
      log: 'Streaming archive to staging…\nInsufficient free space on data volume: need ~37 GiB, have 12 GiB\n',
      original_filename: 'backup.tar.gz',
      result_filename: null,
      error_message: 'Insufficient free space on data volume: need ~37 GiB, have 12 GiB',
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    const filesImportInput = screen.getByTestId('files-import-input') as HTMLInputElement
    await user.upload(
      filesImportInput,
      new File(['archive'], 'backup.tar.gz', { type: 'application/gzip' }),
    )
    expect(await screen.findByRole('dialog', { name: 'Import filesystem?' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('checkbox', { name: /I have verified a recent backup exists/i }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'I understand, proceed' })).toBeEnabled(),
    )
    await user.click(await screen.findByRole('button', { name: 'I understand, proceed' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import filesystem?' })).not.toBeInTheDocument(),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(
      await screen.findByText(/Insufficient free space on data volume: need ~37 GiB, have 12 GiB/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Operation failed')).not.toBeInTheDocument()
  })

  it('lists retained archives and supports rerun and delete actions', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    mockFetchFilesImportArchives.mockResolvedValue([
      {
        archive_task_id: 7,
        original_filename: 'backup.tar.gz',
        size_bytes: 5_368_709_120,
        created_at: '2026-06-19T19:00:00Z',
        last_status: 'completed',
      },
    ])
    mockRerunFilesImportArchive.mockResolvedValue({
      id: 9,
      task_type: 'files_import',
      status: 'pending',
      progress: 0,
      log: '',
      original_filename: 'backup.tar.gz',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:10:00Z',
      updated_at: '2026-06-19T19:10:00Z',
    })
    mockDeleteFilesImportArchive.mockResolvedValue({
      archive_task_id: 7,
      deleted: true,
      path: '/data/admin_tasks/import-1.tar.gz',
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(await screen.findByText('Previously uploaded import archives')).toBeInTheDocument()
    expect(screen.getByText('backup.tar.gz')).toBeInTheDocument()
    expect(screen.getByText(/Task #7/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Re-run import' }))
    await waitFor(() => expect(mockRerunFilesImportArchive).toHaveBeenCalledWith(7))
    await waitFor(() => expect(mockFetchFilesImportArchives).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockDeleteFilesImportArchive).toHaveBeenCalledWith(7))
    await waitFor(() => expect(mockFetchFilesImportArchives).toHaveBeenCalledTimes(3))
  })

  it('shows cumulative storage usage for retained archives', async () => {
    const user = userEvent.setup()

    mockFetchFilesImportArchives.mockResolvedValue([
      {
        archive_task_id: 7,
        original_filename: 'backup-a.tar.gz',
        size_bytes: 5_368_709_120, // 5 GiB
        created_at: '2026-06-19T19:00:00Z',
        last_status: 'completed',
      },
      {
        archive_task_id: 8,
        original_filename: 'backup-b.tar.gz',
        size_bytes: 10_737_418_240, // 10 GiB
        created_at: '2026-06-20T19:00:00Z',
        last_status: 'completed',
      },
    ])

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(await screen.findByText('2 retained archives using 15.0 GiB')).toBeInTheDocument()
  })

  it('shows the active archive retention policy when configured', async () => {
    const user = userEvent.setup()
    mockFetchFilesImportArchiveRetention.mockResolvedValue({
      retention_count: 3,
      retention_days: 30,
    })

    render(<AdminPage />)
    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    const alert = await screen.findByTestId('import-archive-retention')
    expect(alert).toHaveTextContent('beyond the newest 3')
    expect(alert).toHaveTextContent('after 30 days')
  })

  it('hides the retention notice when the policy is disabled', async () => {
    const user = userEvent.setup()

    render(<AdminPage />)
    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(await screen.findByText('Previously uploaded import archives')).toBeInTheDocument()
    expect(screen.queryByTestId('import-archive-retention')).not.toBeInTheDocument()
  })

  it('lists stored export archives with cumulative usage and purges one', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    mockListExportArchives.mockResolvedValue({
      archives: [
        {
          task_id: 12,
          task_type: 'db_export',
          artifact_role: 'result',
          filename: 'db-export-12.json',
          size_bytes: 5_368_709_120, // 5 GiB
          status: 'completed',
          created_at: '2026-06-19T19:00:00Z',
          updated_at: '2026-06-19T19:02:00Z',
          purgeable: true,
        },
      ],
      total_size_bytes: 5_368_709_120,
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(await screen.findByText('Stored export archives')).toBeInTheDocument()
    expect(screen.getByText('db-export-12.json')).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.textContent === '1 archive using 5.00 GiB'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Task #12 · db_export/)).toBeInTheDocument()

    await waitFor(() => expect(mockListExportArchives).toHaveBeenCalledTimes(1))

    await user.click(screen.getByTestId('export-archive-delete-12'))
    await waitFor(() => expect(mockPurgeExportArchive).toHaveBeenCalledWith(12, 'result'))
    // Purge triggers a refresh of the stored-archives list.
    await waitFor(() => expect(mockListExportArchives).toHaveBeenCalledTimes(2))
  })

  it('disables the delete button for a still-active export archive', async () => {
    const user = userEvent.setup()

    mockListExportArchives.mockResolvedValue({
      archives: [
        {
          task_id: 13,
          task_type: 'files_export',
          artifact_role: 'result',
          filename: 'files-export-13.tar.gz',
          size_bytes: 1024,
          status: 'running',
          created_at: '2026-06-19T19:00:00Z',
          updated_at: '2026-06-19T19:00:30Z',
          purgeable: false,
        },
      ],
      total_size_bytes: 1024,
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))

    expect(await screen.findByText('files-export-13.tar.gz')).toBeInTheDocument()
    expect(screen.getByTestId('export-archive-delete-13')).toBeDisabled()
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

  it('does not resume polling when an in-flight poll resolves after cancellation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    let resolvePoll!: (task: Awaited<ReturnType<typeof api.fetchAdminTask>>) => void
    const inFlightPoll = new Promise<Awaited<ReturnType<typeof api.fetchAdminTask>>>((resolve) => {
      resolvePoll = resolve
    })
    mockFetchAdminTask.mockReturnValueOnce(inFlightPoll)

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mockFetchAdminTask).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await waitFor(() => expect(mockCancelAdminTask).toHaveBeenCalledWith(1))

    resolvePoll({
      id: 1,
      task_type: 'db_export',
      status: 'running',
      progress: 20,
      log: 'still running',
      result_filename: null,
      error_message: null,
      created_by: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:02Z',
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mockFetchAdminTask).toHaveBeenCalledTimes(1)
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

  it('offers a download for a completed export and lets the user view then close the task log', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockFetchAdminTask.mockResolvedValue({
      id: 1,
      task_type: 'db_export',
      status: 'completed',
      progress: 100,
      log: 'Database export finished',
      result_filename: 'db-export.sql.gz',
      error_message: null,
      created_by: 1,
      created_at: '2026-06-19T19:00:00Z',
      updated_at: '2026-06-19T19:02:00Z',
    })

    render(<AdminPage />)

    await user.click(screen.getByRole('tab', { name: 'Backups' }))
    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(await screen.findByText(/Database Export completed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(mockDownloadAdminTaskResult).toHaveBeenCalledWith(1)

    await user.click(screen.getByRole('button', { name: 'Details' }))
    const dialog = await screen.findByRole('dialog', { name: /Database Export — Task #1/i })
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(mockDownloadAdminTaskResult).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Database Export — Task #1/i }),
      ).not.toBeInTheDocument(),
    )
  }, 30_000)
  describe('AdminPage — durable parallel rebuilds (#1191)', () => {
    const openBackupsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('tab', { name: 'Backups' }))
      await screen.findByText('Parallel tile rebuilds')
    }

    it('uses the parallel jobs endpoint when the capability is enabled', async () => {
      const user = userEvent.setup()
      mockFetchRebuildTilesCapability.mockResolvedValue({ enabled: true, parallelism: 2 })
      mockStartParallelRebuildTiles.mockResolvedValue(rebuildJob({ status: 'queued' }))

      render(<AdminPage />)
      await openBackupsTab(user)

      await user.click(screen.getByRole('button', { name: 'Rebuild Tiles' }))

      await waitFor(() => expect(mockStartParallelRebuildTiles).toHaveBeenCalledTimes(1))
      expect(mockStartRebuildTiles).not.toHaveBeenCalled()
      expect(await screen.findByTestId('rebuild-job-7')).toBeInTheDocument()
      expect(screen.getByTestId('rebuild-job-status-7')).toHaveTextContent('Queued')
    })

    it('falls back to the serial task runner when parallel is disabled', async () => {
      const user = userEvent.setup()

      render(<AdminPage />)
      await openBackupsTab(user)

      await user.click(screen.getByRole('button', { name: 'Rebuild Tiles' }))

      await waitFor(() => expect(mockStartRebuildTiles).toHaveBeenCalledTimes(1))
      expect(mockStartParallelRebuildTiles).not.toHaveBeenCalled()
      expect(screen.getByTestId('parallel-rebuild-disabled-note')).toBeInTheDocument()
    })

    it('surfaces a 409 from the parallel endpoint as an error, not a task', async () => {
      const user = userEvent.setup()
      mockFetchRebuildTilesCapability.mockResolvedValue({ enabled: true, parallelism: 2 })
      mockStartParallelRebuildTiles.mockRejectedValue(
        new api.ApiError(409, 'Parallel tile rebuilds are disabled'),
      )

      render(<AdminPage />)
      await openBackupsTab(user)

      await user.click(screen.getByRole('button', { name: 'Rebuild Tiles' }))

      expect(await screen.findByText(/Parallel tile rebuilds are disabled/)).toBeInTheDocument()
      expect(mockStartRebuildTiles).not.toHaveBeenCalled()
    })

    it('lists rebuild jobs with counts and polls only while active', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockListJobs
        .mockResolvedValueOnce([rebuildJob({ status: 'running' })])
        .mockResolvedValue([rebuildJob({ status: 'completed', progress: 100 })])

      render(<AdminPage />)
      await openBackupsTab(user)

      expect(screen.getByTestId('rebuild-job-7')).toBeInTheDocument()
      expect(screen.getByText(/Queued 4 · Running 1 · Completed 4/)).toBeInTheDocument()

      // Active job → next list poll fires after the interval.
      const callsAfterLoad = mockListJobs.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(mockListJobs.mock.calls.length).toBeGreaterThan(callsAfterLoad)
      const callsAfterFirstPoll = mockListJobs.mock.calls.length

      // Job is now terminal → polling stops; no further requests are made.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(mockListJobs.mock.calls.length).toBe(callsAfterFirstPoll)
      expect(screen.getByTestId('rebuild-job-status-7')).toHaveTextContent('Completed')
    })

    it('never polls when no rebuild job is active', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockListJobs.mockResolvedValue([
        rebuildJob({ status: 'completed' }),
        rebuildJob({ id: 9, job_type: 'bulk_import', status: 'running' }),
      ])

      render(<AdminPage />)
      await openBackupsTab(user)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      // Only the single mount-time load — a running non-rebuild job does not
      // keep the rebuild poller alive.
      expect(mockListJobs).toHaveBeenCalledTimes(1)
    })

    it('cancels an active rebuild job from the panel', async () => {
      const user = userEvent.setup()
      mockListJobs.mockResolvedValue([rebuildJob({ status: 'running' })])
      mockCancelJob.mockResolvedValue(rebuildJob({ status: 'cancelling' }))

      render(<AdminPage />)
      await openBackupsTab(user)

      await user.click(screen.getByTestId('cancel-rebuild-job-7'))

      await waitFor(() => expect(mockCancelJob).toHaveBeenCalledWith(7))
      await waitFor(() =>
        expect(screen.getByTestId('rebuild-job-status-7')).toHaveTextContent('Cancelling'),
      )
    })

    it('loads failed items lazily and paginates via Load more', async () => {
      const user = userEvent.setup()
      mockListJobs.mockResolvedValue([
        rebuildJob({ status: 'completed_with_errors', failed_count: 2, progress: 100 }),
      ])
      mockFetchJobItems
        .mockResolvedValueOnce({ items: [failedItem(1)], next_after_id: 11 })
        .mockResolvedValueOnce({ items: [failedItem(12)], next_after_id: null })

      render(<AdminPage />)
      await openBackupsTab(user)

      // Nothing fetched until the operator expands the section.
      expect(mockFetchJobItems).not.toHaveBeenCalled()
      await user.click(screen.getByTestId('failed-items-toggle-7'))

      await waitFor(() =>
        expect(mockFetchJobItems).toHaveBeenCalledWith(7, {
          status: 'failed',
          afterId: undefined,
          limit: 50,
        }),
      )
      expect(await screen.findByTestId('rebuild-item-1')).toBeInTheDocument()
      expect(screen.getByText(/operational error/)).toBeInTheDocument()

      await user.click(screen.getByTestId('failed-items-more-7'))
      await waitFor(() =>
        expect(mockFetchJobItems).toHaveBeenCalledWith(7, {
          status: 'failed',
          afterId: 11,
          limit: 50,
        }),
      )
      expect(await screen.findByTestId('rebuild-item-12')).toBeInTheDocument()
      // Exhausted → no more Load more.
      expect(screen.queryByTestId('failed-items-more-7')).not.toBeInTheDocument()
    })

    it('retries one failed item and removes it from the list', async () => {
      const user = userEvent.setup()
      mockListJobs.mockResolvedValue([
        rebuildJob({ status: 'completed_with_errors', failed_count: 1 }),
      ])
      mockFetchJobItems.mockResolvedValue({ items: [failedItem(5)], next_after_id: null })
      mockRetryJobItem.mockResolvedValue({
        requeued_count: 1,
        job: rebuildJob({ status: 'running', failed_count: 0, queued_count: 5 }),
      })

      render(<AdminPage />)
      await openBackupsTab(user)
      await user.click(screen.getByTestId('failed-items-toggle-7'))
      await screen.findByTestId('rebuild-item-5')

      await user.click(screen.getByTestId('retry-item-5'))

      await waitFor(() => expect(mockRetryJobItem).toHaveBeenCalledWith(7, 5))
      await waitFor(() => expect(screen.queryByTestId('rebuild-item-5')).not.toBeInTheDocument())
    })

    it('retries all failed items and clears the expanded list', async () => {
      const user = userEvent.setup()
      mockListJobs.mockResolvedValue([
        rebuildJob({ status: 'completed_with_errors', failed_count: 2 }),
      ])
      mockFetchJobItems.mockResolvedValue({
        items: [failedItem(1), failedItem(2)],
        next_after_id: null,
      })
      mockRetryFailedJobItems.mockResolvedValue({
        requeued_count: 2,
        job: rebuildJob({ status: 'running', failed_count: 0, queued_count: 6 }),
      })

      render(<AdminPage />)
      await openBackupsTab(user)
      await user.click(screen.getByTestId('failed-items-toggle-7'))
      await screen.findByTestId('rebuild-item-1')

      await user.click(screen.getByTestId('retry-failed-7'))

      await waitFor(() => expect(mockRetryFailedJobItems).toHaveBeenCalledWith(7))
      // The stale failed-items cache was dropped and the list collapsed.
      await waitFor(() => expect(screen.queryByTestId('rebuild-item-1')).not.toBeInTheDocument())
    })

    it('keeps a newly created job when a stale mount-time list resolves late', async () => {
      const user = userEvent.setup()
      let resolveMountList: (jobs: api.ApiJob[]) => void = () => {}
      mockListJobs.mockReturnValueOnce(
        new Promise<api.ApiJob[]>((resolve) => {
          resolveMountList = resolve
        }),
      )
      mockFetchRebuildTilesCapability.mockResolvedValue({
        enabled: true,
        parallelism: 2,
      })
      mockStartParallelRebuildTiles.mockResolvedValue(rebuildJob({ status: 'queued' }))

      render(<AdminPage />)
      await openBackupsTab(user)

      // Create while the mount-time listJobs request is still in flight.
      await user.click(screen.getByRole('button', { name: 'Rebuild Tiles' }))
      expect(await screen.findByTestId('rebuild-job-7')).toBeInTheDocument()

      // The pre-creation snapshot resolves late — it must not wipe job 7.
      await act(async () => {
        resolveMountList([])
      })
      expect(screen.getByTestId('rebuild-job-7')).toBeInTheDocument()
    })

    it('distinguishes completed_with_errors from clean completion', async () => {
      const user = userEvent.setup()
      mockListJobs.mockResolvedValue([
        rebuildJob({ id: 7, status: 'completed_with_errors', failed_count: 2 }),
        rebuildJob({ id: 8, status: 'completed', failed_count: 0, progress: 100 }),
      ])

      render(<AdminPage />)
      await openBackupsTab(user)

      expect(screen.getByTestId('rebuild-job-status-7')).toHaveTextContent('Completed with errors')
      expect(screen.getByTestId('rebuild-job-status-8')).toHaveTextContent('Completed')
      // Partial failure keeps the retry affordance; clean completion does not.
      expect(screen.getByTestId('retry-failed-7')).toBeInTheDocument()
      expect(screen.queryByTestId('retry-failed-8')).not.toBeInTheDocument()
    })
  })
})
