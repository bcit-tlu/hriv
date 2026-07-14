import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CancelIcon from '@mui/icons-material/Cancel'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  ApiError,
  deleteFilesImportArchive,
  fetchBackupSnapshotManifest,
  fetchFilesImportArchives,
  listExportArchives,
  purgeExportArchive,
  startDbExport,
  startDbImport,
  listBackupSnapshots,
  startFilesExport,
  initFilesImport,
  startRebuildTiles,
  rerunFilesImportArchive,
  startFileRestore,
  uploadTaskFile,
  fetchAdminTask,
  fetchAdminTasks,
  cancelAdminTask,
  downloadAdminTaskResult,
  userMessage,
} from '../api'
import type {
  AdminTask,
  BackupSnapshotManifest,
  BackupSnapshotSummary,
  ExportArchive,
  FilesImportArchive,
} from '../api'
import { useAuth } from '../useAuth'
import ConfirmImportDialog, { type ConfirmImportKind } from './ConfirmImportDialog'
import ChangelogAdmin from './ChangelogAdmin'

const POLL_INTERVAL = 2000 // ms

// A 401/403 during a task interaction means the acting account was replaced
// (e.g. by a database import) and the current JWT is no longer valid.
const isAuthFailure = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.status === 401 || err.status === 403)

function hasAdminTaskShape(task: unknown): task is AdminTask {
  return typeof task === 'object' && task !== null && typeof (task as { id?: unknown }).id === 'number'
}

const TASK_LABELS: Record<string, string> = {
  db_export: 'Database Export',
  db_import: 'Database Import',
  files_export: 'Filesystem Export',
  files_import: 'Filesystem Import',
  file_restore: 'File Restore',
  rebuild_tiles: 'Rebuild Tiles',
}

function isRestoreNotConfigured(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 400 &&
    err.detail.toLowerCase().includes('backup restore is not configured')
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; i < units.length; i++) {
    if (value < 1024) break
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

function getLatestLogLine(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.at(-1) ?? ''
}

function getTaskStatusText(task: AdminTask): string {
  if (task.status === 'cancelling') return 'Cancelling…'
  const latest = getLatestLogLine(task.log)
  if (task.status === 'failed') {
    return task.error_message ?? latest ?? 'Import failed'
  }
  return latest || `Progress: ${task.progress}%`
}

function getTaskProgressValue(task: AdminTask, uploadProgress: Map<number, number>): number {
  if (task.status === 'uploading') {
    return (uploadProgress.get(task.id) ?? 0) * 100
  }
  return task.progress
}

function shortHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash
}

/** Snackbar notification for a completed/failed task. */
interface TaskNotification {
  id: number
  task: AdminTask
}

interface AdminPageProps {
  onChangelogEntriesChanged?: () => void
}

type AdminTabValue = 'changelog' | 'backups'

interface AdminTabPanelProps {
  children: ReactNode
  value: AdminTabValue
  currentValue: AdminTabValue
}

function AdminTabPanel({ children, value, currentValue }: AdminTabPanelProps) {
  const hidden = value !== currentValue
  return (
    <Box
      role="tabpanel"
      hidden={hidden}
      id={`admin-tabpanel-${value}`}
      aria-labelledby={`admin-tab-${value}`}
      sx={{ pt: 3 }}
    >
      {children}
    </Box>
  )
}

export default function AdminPage({ onChangelogEntriesChanged }: AdminPageProps) {
  const { logout } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  // Active background tasks being polled
  const [activeTasks, setActiveTasks] = useState<AdminTask[]>([])
  // Client-side upload progress for tasks in "uploading" status (0–1).
  const [uploadProgress, setUploadProgress] = useState<Map<number, number>>(new Map())
  const [filesImportArchives, setFilesImportArchives] = useState<FilesImportArchive[]>([])
  const [filesImportArchivesLoading, setFilesImportArchivesLoading] = useState(false)
  const [filesImportArchivesError, setFilesImportArchivesError] = useState<string | null>(null)
  const [exportArchives, setExportArchives] = useState<ExportArchive[]>([])
  const [exportArchivesTotalBytes, setExportArchivesTotalBytes] = useState(0)
  const [exportArchivesLoading, setExportArchivesLoading] = useState(false)
  const [exportArchivesError, setExportArchivesError] = useState<string | null>(null)
  // Completed/failed task history (loaded once)
  const [taskHistory, setTaskHistory] = useState<AdminTask[]>([])
  // Snackbar notifications
  const [notifications, setNotifications] = useState<TaskNotification[]>([])
  // Log viewer modal
  const [logTask, setLogTask] = useState<AdminTask | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTabValue>('changelog')
  const [taskHistoryExpanded, setTaskHistoryExpanded] = useState(false)
  const [restoreSnapshots, setRestoreSnapshots] = useState<BackupSnapshotSummary[]>([])
  const [restoreConfigured, setRestoreConfigured] = useState<boolean | null>(null)
  const [restoreLoadingSnapshots, setRestoreLoadingSnapshots] = useState(false)
  const [restorePanelError, setRestorePanelError] = useState<string | null>(null)
  const [selectedRestoreSnapshot, setSelectedRestoreSnapshot] = useState('')
  const [selectedRestoreManifest, setSelectedRestoreManifest] =
    useState<BackupSnapshotManifest | null>(null)
  const [restoreManifestLoading, setRestoreManifestLoading] = useState(false)
  const [restoreManifestFilter, setRestoreManifestFilter] = useState('')
  const [selectedRestoreMemberPath, setSelectedRestoreMemberPath] = useState<string | null>(null)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null) // task_type being kicked off
  const [sessionEndedMessage, setSessionEndedMessage] = useState<string | null>(null)

  const pollRefs = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // Abort controllers for in-flight XHR uploads, keyed by task ID.
  // Used to abort the upload immediately when a user cancels an
  // uploading task (#266).
  const uploadAbortRefs = useRef(new Map<number, AbortController>())

  // Log viewer auto-scroll: the pre element that holds the streaming
  // task log, and a sticky-bottom flag that pauses auto-scroll if the
  // user scrolls up to read earlier output and resumes once they scroll
  // back to the bottom.  Stored in a ref so scrolling doesn't trigger
  // re-renders on every wheel event.
  const logBoxRef = useRef<HTMLElement | null>(null)
  const stickToBottomRef = useRef(true)

  const handleLogScroll = useCallback(() => {
    const el = logBoxRef.current
    if (el === null) return
    // Treat "within 16px of bottom" as still docked — keeps kinetic
    // scroll/touchpad overshoot from detaching the autoscroll.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom <= 16
  }, [])

  // Load task history on mount
  useEffect(() => {
    fetchAdminTasks()
      .then(setTaskHistory)
      .catch(() => {
        /* ignore */
      })
  }, [])

  // ── Polling ──────────────────────────────────────────────

  const stopPolling = useCallback((taskId: number) => {
    const ref = pollRefs.current.get(taskId)
    if (ref !== undefined) {
      clearTimeout(ref)
      pollRefs.current.delete(taskId)
    }
  }, [])

  const stopAllPolling = useCallback(() => {
    for (const taskId of Array.from(pollRefs.current.keys())) {
      stopPolling(taskId)
    }
  }, [stopPolling])

  const syncTask = useCallback((updated: AdminTask) => {
    setActiveTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setTaskHistory((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setLogTask((prev) => (prev?.id === updated.id ? updated : prev))
  }, [])

  const isTerminalTask = (task: AdminTask) =>
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'

  const loadExportArchives = useCallback(async () => {
    setExportArchivesLoading(true)
    setExportArchivesError(null)
    try {
      const { archives, total_size_bytes } = await listExportArchives()
      setExportArchives(archives)
      setExportArchivesTotalBytes(total_size_bytes)
    } catch (err) {
      setExportArchivesError(userMessage(err, 'Failed to load export archives'))
    } finally {
      setExportArchivesLoading(false)
    }
  }, [])

  // Stop polling a task that has reached a terminal state, surface a
  // notification, and refresh history — mirrors the poll loop's terminal
  // handling so a task finalised outside the poll cycle (e.g. reconciled in
  // handleCancel) still notifies the operator.
  const finalizeTerminalTask = useCallback(
    (task: AdminTask) => {
      stopPolling(task.id)
      setNotifications((prev) =>
        prev.some((n) => n.id === task.id) ? prev : [...prev, { id: task.id, task }],
      )
      fetchAdminTasks()
        .then(setTaskHistory)
        .catch(() => {
          /* ignore */
        })
      // A completed export produces a new on-disk archive; refresh the
      // stored-archives panel so it appears without a manual tab switch.
      if (
        task.status === 'completed' &&
        (task.task_type === 'db_export' || task.task_type === 'files_export')
      ) {
        void loadExportArchives()
      }
    },
    [stopPolling, loadExportArchives],
  )

  const handleSessionEnded = useCallback(
    (taskId: number) => {
      stopAllPolling()
      setStarting(null)
      setSessionEndedMessage(
        (prev) =>
          prev ??
          'Your session ended because your account was replaced by the imported data. The task is still running on the server and will complete — please log back in, then check Recent Tasks to confirm it finished.',
      )
      setNotifications((prev) => prev.filter((n) => n.id !== taskId))
    },
    [stopAllPolling],
  )

  const pollTask = useCallback(
    (taskId: number) => {
      if (pollRefs.current.has(taskId)) return // already polling

      const schedule = () => {
        const handle = setTimeout(async () => {
          try {
            const updated = await fetchAdminTask(taskId)
            if (!hasAdminTaskShape(updated)) {
              schedule()
              return
            }

            // Update active tasks list
            syncTask(updated)

            if (isTerminalTask(updated)) {
              finalizeTerminalTask(updated)
            } else {
              schedule()
            }
          } catch (err) {
            if (isAuthFailure(err)) {
              handleSessionEnded(taskId)
              return
            }
            // Network error — retry
            schedule()
          }
        }, POLL_INTERVAL)
        pollRefs.current.set(taskId, handle)
      }

      schedule()
    },
    [finalizeTerminalTask, handleSessionEnded, syncTask],
  )

  // Clean up polling on unmount
  useEffect(() => {
    const refs = pollRefs.current
    return () => {
      for (const handle of refs.values()) clearTimeout(handle)
      refs.clear()
    }
  }, [])

  // Re-dock the log viewer to the bottom whenever a new log panel is
  // opened so the most recent output is visible immediately.
  useEffect(() => {
    if (logTask === null) return
    stickToBottomRef.current = true
    const el = logBoxRef.current
    if (el !== null) {
      el.scrollTop = el.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logTask?.id])

  // Keep the log pinned to the bottom as new content streams in — but
  // only when the user hasn't scrolled up to read older lines.
  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = logBoxRef.current
    if (el !== null) {
      el.scrollTop = el.scrollHeight
    }
  }, [logTask?.log])

  // ── Kick-off helpers ─────────────────────────────────────

  const kickOff = useCallback(
    async (taskType: string, starter: () => Promise<AdminTask>) => {
      setError(null)
      setStarting(taskType)
      try {
        const task = await starter()
        setActiveTasks((prev) => [...prev, task])
        pollTask(task.id)
      } catch (err) {
        setError(userMessage(err, 'Operation failed'))
      } finally {
        setStarting(null)
      }
    },
    [pollTask],
  )

  const loadRestoreManifest = useCallback(async (snapshotName: string) => {
    if (!snapshotName) {
      setSelectedRestoreManifest(null)
      setSelectedRestoreMemberPath(null)
      return
    }
    setRestoreManifestLoading(true)
    setRestorePanelError(null)
    try {
      const manifest = await fetchBackupSnapshotManifest(snapshotName)
      setSelectedRestoreManifest(manifest)
      setSelectedRestoreMemberPath(null)
    } catch (err) {
      if (isRestoreNotConfigured(err)) {
        setRestoreConfigured(false)
        setRestoreSnapshots([])
        setSelectedRestoreSnapshot('')
        setSelectedRestoreManifest(null)
        setSelectedRestoreMemberPath(null)
        setRestoreManifestFilter('')
        return
      }
      setRestorePanelError(userMessage(err, 'Failed to load backup snapshot manifest'))
    } finally {
      setRestoreManifestLoading(false)
    }
  }, [])

  const loadRestoreSnapshots = useCallback(async () => {
    setRestoreLoadingSnapshots(true)
    setRestorePanelError(null)
    try {
      const snapshots = await listBackupSnapshots()
      setRestoreConfigured(true)
      setRestoreSnapshots(snapshots)
      const nextSnapshot =
        snapshots.find((snapshot) => snapshot.name === selectedRestoreSnapshot)?.name ??
        snapshots[0]?.name ??
        ''
      setSelectedRestoreSnapshot(nextSnapshot)
      if (nextSnapshot) {
        void loadRestoreManifest(nextSnapshot)
      } else {
        setSelectedRestoreManifest(null)
        setSelectedRestoreMemberPath(null)
      }
    } catch (err) {
      if (isRestoreNotConfigured(err)) {
        setRestoreConfigured(false)
        setRestoreSnapshots([])
        setSelectedRestoreSnapshot('')
        setSelectedRestoreManifest(null)
        setSelectedRestoreMemberPath(null)
        setRestoreManifestFilter('')
        return
      }
      setRestoreConfigured(true)
      setRestorePanelError(userMessage(err, 'Failed to load backup snapshots'))
    } finally {
      setRestoreLoadingSnapshots(false)
    }
  }, [loadRestoreManifest, selectedRestoreSnapshot])

  const loadFilesImportArchives = useCallback(async () => {
    setFilesImportArchivesLoading(true)
    setFilesImportArchivesError(null)
    try {
      const archives = await fetchFilesImportArchives()
      setFilesImportArchives(archives)
    } catch (err) {
      setFilesImportArchivesError(userMessage(err, 'Failed to load import archives'))
    } finally {
      setFilesImportArchivesLoading(false)
    }
  }, [])

  const handleExport = () => kickOff('db_export', startDbExport)
  const handleExportFiles = () => kickOff('files_export', startFilesExport)
  const handleRebuildTiles = () => kickOff('rebuild_tiles', startRebuildTiles)

  const handleImportClick = () => fileRef.current?.click()
  const handleImportFilesClick = () => filesRef.current?.click()

  // File selected → queue a confirmation dialog rather than firing the
  // destructive import immediately. The dialog requires the admin to
  // acknowledge that a recent backup exists before the API call fires
  // (see ConfirmImportDialog).
  const [pendingImport, setPendingImport] = useState<{
    kind: ConfirmImportKind
    file: File
  } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPendingImport({ kind: 'db_import', file })
  }

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPendingImport({ kind: 'files_import', file })
  }

  const handleCancelImport = () => setPendingImport(null)

  const handleConfirmImport = async () => {
    if (!pendingImport) return
    const { kind, file } = pendingImport
    setPendingImport(null)
    if (kind === 'db_import') {
      await kickOff('db_import', () => startDbImport(file))
    } else {
      // Two-step flow: create task first (visible immediately), then
      // upload via XHR with progress.
      setError(null)
      setStarting('files_import')
      let task: AdminTask | undefined
      try {
        task = await initFilesImport(file.name)
        setActiveTasks((prev) => [...prev, task!])
        pollTask(task.id)
        setStarting(null) // task banner takes over

        const abort = new AbortController()
        uploadAbortRefs.current.set(task.id, abort)
        await uploadTaskFile(
          task.id,
          file,
          (fraction) => {
            setUploadProgress((prev) => new Map(prev).set(task!.id, fraction))
          },
          abort.signal,
        )
        // Upload done — clear local progress; polling picks up the rest.
        setUploadProgress((prev) => {
          const next = new Map(prev)
          next.delete(task!.id)
          return next
        })
        void loadFilesImportArchives()
      } catch (err) {
        // Suppress AbortError — the cancel handler already took care
        // of UI cleanup and the backend cancellation request (#266).
        if (err instanceof DOMException && err.name === 'AbortError') {
          // noop — polling will pick up the cancelled status
        } else if (task !== undefined) {
          // Upload failed after the task was created — remove the
          // stale task from the UI and stop its polling loop (#264).
          stopPolling(task.id)
          setActiveTasks((prev) => prev.filter((t) => t.id !== task!.id))
          // Only clear the failed task's progress entry (#265).
          setUploadProgress((prev) => {
            const next = new Map(prev)
            next.delete(task!.id)
            return next
          })
          cancelAdminTask(task.id).catch(() => {})
          setError(userMessage(err, 'Operation failed'))
        } else {
          setError(userMessage(err, 'Operation failed'))
        }
        setStarting(null)
      } finally {
        if (task !== undefined) uploadAbortRefs.current.delete(task.id)
      }
    }
  }

  const handleBackupsTabChange = (_event: React.SyntheticEvent, value: AdminTabValue) => {
    setActiveTab(value)
    if (value === 'backups') {
      void loadRestoreSnapshots()
      void loadFilesImportArchives()
      void loadExportArchives()
    }
  }

  const handleRestoreSnapshotSelect = (snapshotName: string) => {
    setSelectedRestoreSnapshot(snapshotName)
    setSelectedRestoreManifest(null)
    setSelectedRestoreMemberPath(null)
    setRestoreManifestFilter('')
    if (snapshotName) {
      void loadRestoreManifest(snapshotName)
    }
  }

  const handleRerunFilesImportArchive = async (archiveTaskId: number) => {
    setError(null)
    try {
      const task = await rerunFilesImportArchive(archiveTaskId)
      setActiveTasks((prev) => [...prev, task])
      pollTask(task.id)
      void loadFilesImportArchives()
    } catch (err) {
      setError(userMessage(err, 'Failed to rerun archive'))
    }
  }

  const handleDeleteFilesImportArchive = async (archiveTaskId: number) => {
    if (!window.confirm('Delete this retained import archive?')) return
    setError(null)
    try {
      await deleteFilesImportArchive(archiveTaskId)
      void loadFilesImportArchives()
    } catch (err) {
      setError(userMessage(err, 'Failed to delete archive'))
    }
  }

  const handlePurgeExportArchive = async (archive: ExportArchive) => {
    if (
      !window.confirm(
        `Delete export archive "${archive.filename}" (${formatBytes(archive.size_bytes)})? This cannot be undone.`,
      )
    )
      return
    setError(null)
    try {
      await purgeExportArchive(archive.task_id, 'result')
      void loadExportArchives()
    } catch (err) {
      setError(userMessage(err, 'Failed to purge export archive'))
    }
  }

  const filteredRestoreEntries = useMemo(() => {
    if (!selectedRestoreManifest?.files) return []
    const entries = Object.entries(selectedRestoreManifest.files).map(([path, entry]) => ({
      path,
      size: entry.size,
      sha256: entry.sha256,
    }))
    const needle = restoreManifestFilter.trim().toLowerCase()
    return entries
      .filter((entry) =>
        needle.length === 0
          ? true
          : [entry.path, entry.sha256, String(entry.size)].some((value) =>
              value.toLowerCase().includes(needle),
            ),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [restoreManifestFilter, selectedRestoreManifest])

  const handleOpenRestoreConfirm = () => {
    if (!selectedRestoreSnapshot || !selectedRestoreMemberPath) return
    setRestoreConfirmOpen(true)
  }

  const handleConfirmRestore = async () => {
    if (!selectedRestoreSnapshot || !selectedRestoreMemberPath) return
    const snapshotName = selectedRestoreSnapshot
    const memberPath = selectedRestoreMemberPath
    setRestoreConfirmOpen(false)
    await kickOff('file_restore', () =>
      startFileRestore({
        snapshot_name: snapshotName,
        member_path: memberPath,
      }),
    )
  }

  // Dismiss a snackbar notification and remove the task from activeTasks
  const dismissNotification = (taskId: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== taskId))
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  // Request cancellation of a running/pending task, or force-cancel a
  // task already stuck in ``cancelling`` (same endpoint — backend
  // transitions ``cancelling`` → ``cancelled`` when called a second
  // time).  ``force`` only controls the confirmation prompt; destructive
  // enough to warrant one because it abandons any in-flight cleanup.
  const handleCancel = async (taskId: number, force = false) => {
    if (
      force &&
      !window.confirm(
        'Force-cancel this task?\n\n' +
          'The runner appears to be stuck. Marking it as cancelled will ' +
          'abandon any in-flight cleanup and unblock new tasks of the ' +
          'same type. Only do this if you are sure the task is no longer ' +
          'making progress.',
      )
    ) {
      return
    }
    // Abort the in-flight XHR upload if one exists for this task
    // (#266). This stops bandwidth waste immediately and prevents the
    // duplicate "Upload failed" error notification.
    const abort = uploadAbortRefs.current.get(taskId)
    if (abort) {
      abort.abort()
      uploadAbortRefs.current.delete(taskId)
      // Clear upload progress for the cancelled task.
      setUploadProgress((prev) => {
        const next = new Map(prev)
        next.delete(taskId)
        return next
      })
    }
    try {
      const updated = await cancelAdminTask(taskId)
      syncTask(updated)
      if (isTerminalTask(updated)) {
        finalizeTerminalTask(updated)
      }
    } catch (err) {
      // A 401/403 means the session ended (e.g. the acting account was
      // replaced by an import) — surface that immediately instead of a
      // misleading "Failed to cancel" error.
      if (isAuthFailure(err)) {
        handleSessionEnded(taskId)
        return
      }
      try {
        const refreshed = await fetchAdminTask(taskId)
        if (!hasAdminTaskShape(refreshed)) {
          throw new Error('Invalid task refresh response')
        }
        syncTask(refreshed)
        if (isTerminalTask(refreshed)) {
          finalizeTerminalTask(refreshed)
          return
        }
      } catch (refreshErr) {
        if (isAuthFailure(refreshErr)) {
          handleSessionEnded(taskId)
          return
        }
        // otherwise fall through to the user-facing error below
      }
      setError(force ? 'Failed to force-cancel task' : 'Failed to cancel task')
    }
  }

  // Disable action buttons while a task is being kicked off OR while
  // any task is still uploading (#263 — setStarting(null) fires before
  // the XHR upload completes, so also check for in-flight uploads).
  const busy =
    starting !== null ||
    sessionEndedMessage !== null ||
    activeTasks.some((t) => t.status === 'uploading')

  // Active (in-flight) tasks for the progress banner
  const runningTasks = activeTasks.filter(
    (t) =>
      t.status === 'uploading' ||
      t.status === 'pending' ||
      t.status === 'running' ||
      t.status === 'cancelling',
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Admin
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {sessionEndedMessage && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={logout}>
              Log back in
            </Button>
          }
        >
          {sessionEndedMessage}
        </Alert>
      )}

      {/* ── Active task progress banners ────────────────── */}
      {!sessionEndedMessage &&
        runningTasks.map((task) => (
          <Alert
            key={task.id}
            severity={task.status === 'cancelling' ? 'warning' : 'info'}
            icon={<CircularProgress size={20} />}
            sx={{ mb: 2 }}
            action={
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {task.status !== 'cancelling' ? (
                  <Button
                    size="small"
                    color="warning"
                    startIcon={<CancelIcon />}
                    onClick={() => handleCancel(task.id)}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="small"
                    color="error"
                    startIcon={<CancelIcon />}
                    onClick={() => handleCancel(task.id, true)}
                  >
                    Force cancel
                  </Button>
                )}
                <Link
                  component="button"
                  variant="body2"
                  underline="always"
                  sx={{ mr: 1, cursor: 'pointer' }}
                  onClick={() => setLogTask(task)}
                >
                  Details
                </Link>
              </Box>
            }
          >
            <Box sx={{ width: '100%' }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {TASK_LABELS[task.task_type] ?? task.task_type}
                {task.status === 'uploading'
                  ? ` — Uploading ${Math.round((uploadProgress.get(task.id) ?? 0) * 100)}%`
                  : ` — ${getTaskStatusText(task)}`}
              </Typography>
              <LinearProgress
                variant={
                  task.status === 'cancelling'
                    ? 'indeterminate'
                    : task.status === 'uploading' && !uploadProgress.has(task.id)
                      ? 'indeterminate'
                      : 'determinate'
                }
                value={getTaskProgressValue(task, uploadProgress)}
                color={task.status === 'cancelling' ? 'warning' : 'primary'}
                sx={{ height: 6, borderRadius: 1 }}
              />
            </Box>
          </Alert>
        ))}

      <Tabs value={activeTab} onChange={handleBackupsTabChange} aria-label="Admin sections">
        <Tab
          label="Changelog"
          value="changelog"
          id="admin-tab-changelog"
          aria-controls="admin-tabpanel-changelog"
        />
        <Tab
          label="Backups"
          value="backups"
          id="admin-tab-backups"
          aria-controls="admin-tabpanel-backups"
        />
      </Tabs>

      <AdminTabPanel value="changelog" currentValue={activeTab}>
        <ChangelogAdmin onEntriesChanged={onChangelogEntriesChanged} />
      </AdminTabPanel>

      <AdminTabPanel value="backups" currentValue={activeTab}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Export
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Card
                sx={{
                  minWidth: 300,
                  maxWidth: 400,
                  flex: '1 1 300px',
                  bgcolor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Export Database
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Download a JSON snapshot of all categories, images, users, and source image
                    records. The export runs in the background — you will be notified when it is
                    ready to download.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={
                      starting === 'db_export' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <DownloadIcon />
                      )
                    }
                    onClick={handleExport}
                    disabled={busy}
                  >
                    {starting === 'db_export' ? 'Starting…' : 'Export'}
                  </Button>
                </CardContent>
              </Card>

              <Card
                sx={{
                  minWidth: 300,
                  maxWidth: 400,
                  flex: '1 1 300px',
                  bgcolor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Export Files
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Create a source-images-only compressed archive (.tar.gz) of the filesystem.
                    Generated tiles are excluded and will be rebuilt after import. The archive is
                    built in the background — you will be notified when it is ready to download.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={
                      starting === 'files_export' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <FolderZipIcon />
                      )
                    }
                    onClick={handleExportFiles}
                    disabled={busy}
                  >
                    {starting === 'files_export' ? 'Starting…' : 'Export'}
                  </Button>
                </CardContent>
              </Card>
            </Box>
          </Box>

          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Stored export archives
            </Typography>
            {exportArchives.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {exportArchives.length} {exportArchives.length === 1 ? 'archive' : 'archives'} using{' '}
                {formatBytes(exportArchivesTotalBytes)}
              </Typography>
            )}
            {exportArchivesError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {exportArchivesError}
              </Alert>
            )}
            {exportArchivesLoading ? (
              <Box sx={{ py: 2 }}>
                <LinearProgress />
              </Box>
            ) : exportArchives.length === 0 ? (
              <Typography color="text.secondary">No stored export archives found.</Typography>
            ) : (
              <List disablePadding>
                {exportArchives.map((archive) => (
                  <Box
                    key={`${archive.task_id}-${archive.artifact_role}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 2,
                      py: 1.5,
                      px: 2,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <ListItemText
                      primary={archive.filename}
                      secondary={
                        <>
                          <Typography component="span" variant="body2" color="text.secondary">
                            Task #{archive.task_id} · {archive.task_type} ·{' '}
                            {formatBytes(archive.size_bytes)} ·{' '}
                            {archive.created_at
                              ? new Date(archive.created_at).toLocaleString()
                              : ''}{' '}
                            · {archive.status}
                          </Typography>
                        </>
                      }
                    />
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={!archive.purgeable}
                      onClick={() => void handlePurgeExportArchive(archive)}
                      data-testid={`export-archive-delete-${archive.task_id}`}
                      sx={{ flexShrink: 0 }}
                    >
                      Delete
                    </Button>
                  </Box>
                ))}
              </List>
            )}
          </Box>

          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Previously uploaded import archives
            </Typography>
            {filesImportArchives.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {filesImportArchives.length} retained{' '}
                {filesImportArchives.length === 1 ? 'archive' : 'archives'} using{' '}
                {formatBytes(
                  filesImportArchives.reduce(
                    (total, archive) => total + (archive.size_bytes ?? 0),
                    0,
                  ),
                )}
              </Typography>
            )}
            {filesImportArchivesError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {filesImportArchivesError}
              </Alert>
            )}
            {filesImportArchivesLoading ? (
              <Box sx={{ py: 2 }}>
                <LinearProgress />
              </Box>
            ) : filesImportArchives.length === 0 ? (
              <Typography color="text.secondary">
                No retained filesystem-import archives found.
              </Typography>
            ) : (
              <List disablePadding>
                {filesImportArchives.map((archive) => (
                  <Box
                    key={archive.archive_task_id}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 2,
                      py: 1.5,
                      px: 2,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <ListItemText
                      primary={archive.original_filename ?? `Archive #${archive.archive_task_id}`}
                      secondary={
                        <>
                          <Typography component="span" variant="body2" color="text.secondary">
                            Task #{archive.archive_task_id} ·{' '}
                            {archive.size_bytes ? formatBytes(archive.size_bytes) : '0 B'} ·{' '}
                            {archive.created_at
                              ? new Date(archive.created_at).toLocaleString()
                              : ''}{' '}
                            · {archive.last_status}
                          </Typography>
                        </>
                      }
                    />
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void handleRerunFilesImportArchive(archive.archive_task_id)}
                      >
                        Re-run import
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() => void handleDeleteFilesImportArchive(archive.archive_task_id)}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </Box>
                ))}
              </List>
            )}
          </Box>

          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Restore individual file
            </Typography>
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 2,
                bgcolor: 'background.paper',
              }}
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Browse backup snapshot manifests, search for a source file, and restore one
                  `data/` member at a time.
                </Typography>

                {restoreConfigured === false ? (
                  <Alert severity="info">
                    Backup restore is not configured yet in this environment. The SAS-backed
                    snapshot browser will enable automatically once the backend credentials are
                    provisioned.
                  </Alert>
                ) : restorePanelError ? (
                  <Alert severity="error">{restorePanelError}</Alert>
                ) : null}

                {restoreLoadingSnapshots ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={28} />
                  </Box>
                ) : (
                  <>
                    <TextField
                      select
                      fullWidth
                      label="Snapshot"
                      value={selectedRestoreSnapshot}
                      onChange={(event) => handleRestoreSnapshotSelect(String(event.target.value))}
                      disabled={restoreConfigured === false || restoreSnapshots.length === 0}
                      helperText={
                        restoreConfigured === false
                          ? 'Restore browsing is disabled until the backend SAS is configured.'
                          : restoreSnapshots.length === 0
                            ? 'No snapshots are available yet.'
                            : 'Choose a snapshot to browse its manifest.'
                      }
                    >
                      <MenuItem value="">
                        <em>Select a snapshot</em>
                      </MenuItem>
                      {restoreSnapshots.map((snapshot) => (
                        <MenuItem key={snapshot.name} value={snapshot.name}>
                          {snapshot.name}
                        </MenuItem>
                      ))}
                    </TextField>

                    {restoreConfigured !== false && selectedRestoreSnapshot && (
                      <>
                        {restoreManifestLoading ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={24} />
                          </Box>
                        ) : selectedRestoreManifest ? (
                          <>
                            <TextField
                              label="Filter files"
                              value={restoreManifestFilter}
                              onChange={(event) => setRestoreManifestFilter(event.target.value)}
                              helperText="Search by path, size, or hash."
                              fullWidth
                            />

                            <Typography variant="body2" color="text.secondary">
                              {filteredRestoreEntries.length} of{' '}
                              {Object.keys(selectedRestoreManifest.files ?? {}).length} file
                              {Object.keys(selectedRestoreManifest.files ?? {}).length === 1
                                ? ''
                                : 's'}{' '}
                              match your filter.
                            </Typography>

                            <Box
                              sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1,
                                maxHeight: 360,
                                overflow: 'auto',
                                bgcolor: 'background.default',
                              }}
                            >
                              {filteredRestoreEntries.length > 0 ? (
                                <List dense disablePadding>
                                  {filteredRestoreEntries.map((entry) => (
                                    <ListItemButton
                                      key={entry.path}
                                      selected={selectedRestoreMemberPath === entry.path}
                                      onClick={() => setSelectedRestoreMemberPath(entry.path)}
                                    >
                                      <ListItemText
                                        primary={entry.path}
                                        secondary={`Size ${formatBytes(entry.size)} · SHA-256 ${shortHash(entry.sha256)}`}
                                      />
                                    </ListItemButton>
                                  ))}
                                </List>
                              ) : (
                                <Box sx={{ p: 2 }}>
                                  <Typography variant="body2" color="text.secondary">
                                    No files match this filter.
                                  </Typography>
                                </Box>
                              )}
                            </Box>

                            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                variant="contained"
                                color="warning"
                                disabled={busy || selectedRestoreMemberPath === null}
                                onClick={handleOpenRestoreConfirm}
                              >
                                Restore selected file
                              </Button>
                            </Box>
                          </>
                        ) : null}
                      </>
                    )}
                  </>
                )}
              </Stack>
            </Box>
          </Box>

          <Accordion
            disableGutters
            expanded={taskHistoryExpanded}
            onChange={(_event, expanded) => setTaskHistoryExpanded(expanded)}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="recent-tasks-content"
              id="recent-tasks-header"
            >
              <Box>
                <Typography variant="h6">Recent Tasks</Typography>
                <Typography variant="body2" color="text.secondary">
                  {taskHistory.length > 0
                    ? `Latest ${Math.min(taskHistory.length, 20)} export/import jobs`
                    : 'No export or import jobs have run yet.'}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {taskHistory.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {taskHistory.slice(0, 20).map((task) => (
                    <Box
                      key={task.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        px: 2,
                        py: 1,
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Chip
                        size="small"
                        label={task.status}
                        color={
                          task.status === 'completed'
                            ? 'success'
                            : task.status === 'failed'
                              ? 'error'
                              : task.status === 'running'
                                ? 'info'
                                : task.status === 'cancelling' || task.status === 'cancelled'
                                  ? 'warning'
                                  : 'default'
                        }
                        sx={{ minWidth: 80 }}
                      />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {TASK_LABELS[task.task_type] ?? task.task_type}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {task.created_at ? new Date(task.created_at).toLocaleString() : ''}
                      </Typography>
                      {(task.status === 'uploading' ||
                        task.status === 'pending' ||
                        task.status === 'running') && (
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => handleCancel(task.id)}
                          title="Cancel"
                        >
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      )}
                      {task.status === 'cancelling' && (
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleCancel(task.id, true)}
                          title="Force cancel (runner appears stuck)"
                        >
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      )}
                      {task.status === 'completed' && task.result_filename && (
                        <IconButton
                          size="small"
                          onClick={() => downloadAdminTaskResult(task.id)}
                          title="Download"
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => setLogTask(task)}
                        title="View details"
                      >
                        <InfoOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography color="text.secondary">
                  No completed, failed, or cancelled tasks yet.
                </Typography>
              )}
            </AccordionDetails>
          </Accordion>

          <Divider />

          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Import
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Card
                sx={{
                  minWidth: 300,
                  maxWidth: 400,
                  flex: '1 1 300px',
                  bgcolor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Import Database
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Upload a previously exported JSON file to replace all current data. This action
                    is destructive — existing records will be overwritten. The import runs in the
                    background.
                  </Typography>
                  <Button
                    variant="contained"
                    color="warning"
                    startIcon={
                      starting === 'db_import' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <UploadFileIcon />
                      )
                    }
                    onClick={handleImportClick}
                    disabled={busy}
                  >
                    {starting === 'db_import' ? 'Starting…' : 'Import'}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json"
                    hidden
                    onChange={handleFileChange}
                  />
                </CardContent>
              </Card>

              <Card
                sx={{
                  minWidth: 300,
                  maxWidth: 400,
                  flex: '1 1 300px',
                  bgcolor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Import Files
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Upload a source-images-only .tar.gz file to replace the filesystem on disk. This
                    action is destructive — existing files will be overwritten. Generated tiles are
                    not included, but a tile rebuild is queued automatically after the import
                    completes. Rebuild Tiles can also be triggered manually if needed.
                  </Typography>
                  <Button
                    variant="contained"
                    color="warning"
                    startIcon={
                      starting === 'files_import' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <UploadFileIcon />
                      )
                    }
                    onClick={handleImportFilesClick}
                    disabled={busy}
                  >
                    {starting === 'files_import' ? 'Starting…' : 'Import'}
                  </Button>
                  <input
                    ref={filesRef}
                    type="file"
                    accept=".tar.gz,.tgz,application/gzip,application/x-gzip,application/x-tar,application/x-compressed-tar"
                    hidden
                    data-testid="files-import-input"
                    onChange={handleFilesChange}
                  />
                </CardContent>
              </Card>

              <Card
                sx={{
                  minWidth: 300,
                  maxWidth: 400,
                  flex: '1 1 300px',
                  bgcolor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Rebuild Tiles
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Regenerate missing or stale DZI tile pyramids from the preserved source images.
                    This is run automatically after a filesystem import, but can also be triggered
                    manually to recover from a cancelled rebuild, a single-file restore, or stale
                    tiles. The operation is idempotent and non-destructive.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={
                      starting === 'rebuild_tiles' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <RefreshIcon />
                      )
                    }
                    onClick={handleRebuildTiles}
                    disabled={busy}
                    data-testid="rebuild-tiles-button"
                  >
                    {starting === 'rebuild_tiles' ? 'Starting…' : 'Rebuild Tiles'}
                  </Button>
                </CardContent>
              </Card>
            </Box>
          </Box>
        </Stack>
      </AdminTabPanel>

      <Dialog
        open={restoreConfirmOpen}
        onClose={() => setRestoreConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm file restore</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2">
              Restore <strong>{selectedRestoreMemberPath ?? ''}</strong> from snapshot{' '}
              <strong>{selectedRestoreSnapshot}</strong>?
            </Typography>
            <Alert severity="warning">
              The file will overwrite the current path under the shared data volume. If this
              restores a source image, its tiles may be stale and can be regenerated with Rebuild
              Tiles if needed.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreConfirmOpen(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={() => void handleConfirmRestore()}>
            Restore
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar notifications ────────────────────────── */}
      {notifications.map((n, index) => (
        <Snackbar
          key={n.id}
          open
          autoHideDuration={n.task.status === 'failed' ? null : 10000}
          onClose={(_event, reason) => {
            if (reason === 'clickaway') return
            dismissNotification(n.id)
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{
            zIndex: 1500,
            bottom: { xs: `${24 + index * 80}px !important` },
          }}
        >
          <Alert
            severity={
              n.task.status === 'completed'
                ? 'success'
                : n.task.status === 'cancelled'
                  ? 'warning'
                  : 'error'
            }
            variant="filled"
            sx={{ width: '100%', alignItems: 'center' }}
            onClose={() => dismissNotification(n.id)}
            action={
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {n.task.status === 'completed' && n.task.result_filename && (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => downloadAdminTaskResult(n.id)}
                    startIcon={<DownloadIcon />}
                  >
                    Download
                  </Button>
                )}
                <Link
                  component="button"
                  color="inherit"
                  variant="body2"
                  underline="always"
                  sx={{ cursor: 'pointer' }}
                  onClick={() => {
                    setLogTask(n.task)
                  }}
                >
                  Details
                </Link>
                <IconButton size="small" color="inherit" onClick={() => dismissNotification(n.id)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            }
          >
            {TASK_LABELS[n.task.task_type] ?? n.task.task_type}{' '}
            {n.task.status === 'completed'
              ? 'completed'
              : n.task.status === 'cancelled'
                ? 'cancelled'
                : 'failed'}
            {n.task.status === 'failed'
              ? `: ${n.task.error_message ?? getLatestLogLine(n.task.log) ?? 'Operation failed'}`
              : n.task.error_message
                ? `: ${n.task.error_message}`
                : ''}
          </Alert>
        </Snackbar>
      ))}

      {/* ── Log viewer modal ──────────────────────────────── */}
      <Dialog open={logTask !== null} onClose={() => setLogTask(null)} maxWidth="md" fullWidth>
        {logTask && (
          <>
            <DialogTitle>
              {TASK_LABELS[logTask.task_type] ?? logTask.task_type} — Task #{logTask.id}
              <Chip
                size="small"
                label={logTask.status}
                color={
                  logTask.status === 'completed'
                    ? 'success'
                    : logTask.status === 'failed'
                      ? 'error'
                      : logTask.status === 'running'
                        ? 'info'
                        : logTask.status === 'cancelling' || logTask.status === 'cancelled'
                          ? 'warning'
                          : 'default'
                }
                sx={{ ml: 2, verticalAlign: 'middle' }}
              />
            </DialogTitle>
            <DialogContent dividers>
              {(logTask.status === 'uploading' ||
                logTask.status === 'running' ||
                logTask.status === 'pending' ||
                logTask.status === 'cancelling') && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {logTask.status === 'uploading'
                      ? `Uploading ${Math.round((uploadProgress.get(logTask.id) ?? 0) * 100)}%`
                      : logTask.status === 'cancelling'
                        ? 'Cancelling…'
                        : getTaskStatusText(logTask)}
                  </Typography>
                  <LinearProgress
                    variant={
                      logTask.status === 'cancelling'
                        ? 'indeterminate'
                        : logTask.status === 'uploading' && !uploadProgress.has(logTask.id)
                          ? 'indeterminate'
                          : 'determinate'
                    }
                    value={getTaskProgressValue(logTask, uploadProgress)}
                    color={logTask.status === 'cancelling' ? 'warning' : 'primary'}
                    sx={{ height: 6, borderRadius: 1 }}
                  />
                </Box>
              )}
              {(logTask.error_message || logTask.status === 'failed') && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {logTask.error_message ?? getLatestLogLine(logTask.log) ?? 'Import failed'}
                </Alert>
              )}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Log Output
              </Typography>
              <Box
                component="pre"
                ref={logBoxRef}
                onScroll={handleLogScroll}
                data-testid="admin-task-log"
                sx={{
                  p: 2,
                  bgcolor: 'grey.900',
                  color: 'grey.100',
                  borderRadius: 1,
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                {logTask.log || '(no output yet)'}
              </Box>
            </DialogContent>
            <DialogActions>
              {(logTask.status === 'uploading' ||
                logTask.status === 'pending' ||
                logTask.status === 'running') && (
                <Button
                  color="warning"
                  startIcon={<CancelIcon />}
                  onClick={() => handleCancel(logTask.id)}
                >
                  Cancel
                </Button>
              )}
              {logTask.status === 'cancelling' && (
                <Button
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => handleCancel(logTask.id, true)}
                >
                  Force cancel
                </Button>
              )}
              {logTask.status === 'completed' && logTask.result_filename && (
                <Button
                  onClick={() => downloadAdminTaskResult(logTask.id)}
                  startIcon={<DownloadIcon />}
                >
                  Download
                </Button>
              )}
              <Button onClick={() => setLogTask(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Destructive-import confirmation (P18). */}
      <ConfirmImportDialog
        open={pendingImport !== null}
        kind={pendingImport?.kind ?? 'db_import'}
        file={pendingImport?.file ?? null}
        onCancel={handleCancelImport}
        onConfirm={handleConfirmImport}
      />
    </Box>
  )
}
