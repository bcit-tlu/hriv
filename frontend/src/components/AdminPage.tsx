import { useCallback, useEffect, useRef, useState } from 'react'
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
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CancelIcon from '@mui/icons-material/Cancel'
import {
  startDbExport,
  startDbImport,
  startFilesExport,
  startFilesImport,
  fetchAdminTask,
  fetchAdminTasks,
  cancelAdminTask,
  downloadAdminTaskResult,
} from '../api'
import type { AdminTask } from '../api'

const POLL_INTERVAL = 2000 // ms

const TASK_LABELS: Record<string, string> = {
  db_export: 'Database Export',
  db_import: 'Database Import',
  files_export: 'Filesystem Export',
  files_import: 'Filesystem Import',
}

/** Snackbar notification for a completed/failed task. */
interface TaskNotification {
  id: number
  task: AdminTask
}

export default function AdminPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  // Active background tasks being polled
  const [activeTasks, setActiveTasks] = useState<AdminTask[]>([])
  // Completed/failed task history (loaded once)
  const [taskHistory, setTaskHistory] = useState<AdminTask[]>([])
  // Snackbar notifications
  const [notifications, setNotifications] = useState<TaskNotification[]>([])
  // Log viewer modal
  const [logTask, setLogTask] = useState<AdminTask | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null) // task_type being kicked off

  const pollRefs = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // Load task history on mount
  useEffect(() => {
    fetchAdminTasks()
      .then(setTaskHistory)
      .catch(() => {/* ignore */})
  }, [])

  // ── Polling ──────────────────────────────────────────────

  const stopPolling = useCallback((taskId: number) => {
    const ref = pollRefs.current.get(taskId)
    if (ref !== undefined) {
      clearTimeout(ref)
      pollRefs.current.delete(taskId)
    }
  }, [])

  const pollTask = useCallback(
    (taskId: number) => {
      if (pollRefs.current.has(taskId)) return // already polling

      const schedule = () => {
        const handle = setTimeout(async () => {
          try {
            const updated = await fetchAdminTask(taskId)

            // Update active tasks list
            setActiveTasks((prev) =>
              prev.map((t) => (t.id === taskId ? updated : t)),
            )

            // Also update the log modal if it's viewing this task
            setLogTask((prev) => (prev?.id === taskId ? updated : prev))

            if (updated.status === 'completed' || updated.status === 'failed') {
              stopPolling(taskId)
              setNotifications((prev) => [...prev, { id: taskId, task: updated }])
              // Refresh history
              fetchAdminTasks()
                .then(setTaskHistory)
                .catch(() => {/* ignore */})
            } else {
              schedule()
            }
          } catch {
            // Network error — retry
            schedule()
          }
        }, POLL_INTERVAL)
        pollRefs.current.set(taskId, handle)
      }

      schedule()
    },
    [stopPolling],
  )

  // Clean up polling on unmount
  useEffect(() => {
    const refs = pollRefs.current
    return () => {
      for (const handle of refs.values()) clearTimeout(handle)
      refs.clear()
    }
  }, [])

  // ── Kick-off helpers ─────────────────────────────────────

  const kickOff = useCallback(
    async (
      taskType: string,
      starter: () => Promise<AdminTask>,
    ) => {
      setError(null)
      setStarting(taskType)
      try {
        const task = await starter()
        setActiveTasks((prev) => [...prev, task])
        pollTask(task.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Operation failed')
      } finally {
        setStarting(null)
      }
    },
    [pollTask],
  )

  const handleExport = () => kickOff('db_export', startDbExport)
  const handleExportFiles = () => kickOff('files_export', startFilesExport)

  const handleImportClick = () => fileRef.current?.click()
  const handleImportFilesClick = () => filesRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await kickOff('db_import', () => startDbImport(file))
  }

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await kickOff('files_import', () => startFilesImport(file))
  }

  // Dismiss a snackbar notification and remove the task from activeTasks
  const dismissNotification = (taskId: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== taskId))
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  // Request cancellation of a running/pending task
  const handleCancel = async (taskId: number) => {
    try {
      const updated = await cancelAdminTask(taskId)
      setActiveTasks((prev) =>
        prev.map((t) => (t.id === taskId ? updated : t)),
      )
      setTaskHistory((prev) =>
        prev.map((t) => (t.id === taskId ? updated : t)),
      )
      if (logTask?.id === taskId) setLogTask(updated)
    } catch {
      setError('Failed to cancel task')
    }
  }

  const busy = starting !== null

  // Active (in-flight) tasks for the progress banner
  const runningTasks = activeTasks.filter(
    (t) => t.status === 'pending' || t.status === 'running' || t.status === 'cancelling',
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

      {/* ── Active task progress banners ────────────────── */}
      {runningTasks.map((task) => (
        <Alert
          key={task.id}
          severity={task.status === 'cancelling' ? 'warning' : 'info'}
          icon={<CircularProgress size={20} />}
          sx={{ mb: 2 }}
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {task.status !== 'cancelling' && (
                <Button
                  size="small"
                  color="warning"
                  startIcon={<CancelIcon />}
                  onClick={() => handleCancel(task.id)}
                >
                  Cancel
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
              {task.status === 'cancelling' ? ' — Cancelling…' : ` — ${task.progress}%`}
            </Typography>
            <LinearProgress
              variant={task.status === 'cancelling' ? 'indeterminate' : 'determinate'}
              value={task.progress}
              color={task.status === 'cancelling' ? 'warning' : 'primary'}
              sx={{ height: 6, borderRadius: 1 }}
            />
          </Box>
        </Alert>
      ))}

      {/* ── Database Section ──────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Database
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 4 }}>
        {/* Export card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Export Database
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Download a JSON snapshot of all categories, images, users, and
              source image records. The export runs in the background — you will
              be notified when it is ready to download.
            </Typography>
            <Button
              variant="contained"
              startIcon={starting === 'db_export' ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
              onClick={handleExport}
              disabled={busy}
            >
              {starting === 'db_export' ? 'Starting…' : 'Export'}
            </Button>
          </CardContent>
        </Card>

        {/* Import card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Import Database
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a previously exported JSON file to replace all current
              data. This action is destructive — existing records will be
              overwritten. The import runs in the background.
            </Typography>
            <Button
              variant="contained"
              color="warning"
              startIcon={starting === 'db_import' ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
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
      </Box>

      <Divider sx={{ mb: 4 }} />

      {/* ── Filesystem Section ────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Filesystem
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 4 }}>
        {/* Export Files card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Export Files
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Create a compressed archive (.tar.gz) of all image tiles,
              thumbnails, and uploaded source files. The archive is built in the
              background — you will be notified when it is ready to download.
            </Typography>
            <Button
              variant="contained"
              startIcon={starting === 'files_export' ? <CircularProgress size={18} color="inherit" /> : <FolderZipIcon />}
              onClick={handleExportFiles}
              disabled={busy}
            >
              {starting === 'files_export' ? 'Starting…' : 'Export'}
            </Button>
          </CardContent>
        </Card>

        {/* Import Files card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Import Files
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a previously exported .tar.gz file to replace all tiles
              and source files on disk. This action is destructive — existing
              files will be overwritten. The import runs in the background.
            </Typography>
            <Button
              variant="contained"
              color="warning"
              startIcon={starting === 'files_import' ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
              onClick={handleImportFilesClick}
              disabled={busy}
            >
              {starting === 'files_import' ? 'Starting…' : 'Import'}
            </Button>
            <input
              ref={filesRef}
              type="file"
              accept=".tar.gz,.tgz"
              hidden
              onChange={handleFilesChange}
            />
          </CardContent>
        </Card>
      </Box>

      {/* ── Recent Tasks ──────────────────────────────────── */}
      {taskHistory.length > 0 && (
        <>
          <Divider sx={{ mb: 4 }} />
          <Typography variant="h6" sx={{ mb: 2 }}>
            Recent Tasks
          </Typography>
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
                  {task.created_at
                    ? new Date(task.created_at).toLocaleString()
                    : ''}
                </Typography>
                {(task.status === 'pending' || task.status === 'running') && (
                  <IconButton
                    size="small"
                    color="warning"
                    onClick={() => handleCancel(task.id)}
                    title="Cancel"
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
        </>
      )}

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
            severity={n.task.status === 'completed' ? 'success' : 'error'}
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
                <IconButton
                  size="small"
                  color="inherit"
                  onClick={() => dismissNotification(n.id)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            }
          >
            {TASK_LABELS[n.task.task_type] ?? n.task.task_type}{' '}
            {n.task.status === 'completed' ? 'completed' : 'failed'}
            {n.task.error_message ? `: ${n.task.error_message}` : ''}
          </Alert>
        </Snackbar>
      ))}

      {/* ── Log viewer modal ──────────────────────────────── */}
      <Dialog
        open={logTask !== null}
        onClose={() => setLogTask(null)}
        maxWidth="md"
        fullWidth
      >
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
              {(logTask.status === 'running' || logTask.status === 'pending' || logTask.status === 'cancelling') && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {logTask.status === 'cancelling' ? 'Cancelling…' : `Progress: ${logTask.progress}%`}
                  </Typography>
                  <LinearProgress
                    variant={logTask.status === 'cancelling' ? 'indeterminate' : 'determinate'}
                    value={logTask.progress}
                    color={logTask.status === 'cancelling' ? 'warning' : 'primary'}
                    sx={{ height: 6, borderRadius: 1 }}
                  />
                </Box>
              )}
              {logTask.error_message && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {logTask.error_message}
                </Alert>
              )}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Log Output
              </Typography>
              <Box
                component="pre"
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
              {(logTask.status === 'pending' || logTask.status === 'running') && (
                <Button
                  color="warning"
                  startIcon={<CancelIcon />}
                  onClick={() => handleCancel(logTask.id)}
                >
                  Cancel
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
    </Box>
  )
}
