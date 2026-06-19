import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PublishIcon from '@mui/icons-material/Publish'
import {
  createChangelogEntry,
  deleteChangelogEntry,
  fetchChangelogEntries,
  updateChangelogEntry,
  userMessage,
  type ApiChangelogEntry,
} from '../api'
import MarkdownContent from './MarkdownContent'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  })
}

function isNewEntry(iso: string) {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 60 * 60 * 1000
}

interface EntryDialogProps {
  open: boolean
  initial: ApiChangelogEntry | null
  onClose: () => void
  onSaved: (entry: ApiChangelogEntry) => void
}

function EntryDialog({ open, initial, onClose, onSaved }: EntryDialogProps) {
  const [tab, setTab] = useState(0)
  const [title, setTitle] = useState(() => initial?.title ?? '')
  const [body, setBody] = useState(() => initial?.body ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    setError(null)
    try {
      const saved = initial
        ? await updateChangelogEntry(initial.id, { title, body })
        : await createChangelogEntry({ title, body })
      onSaved(saved)
    } catch (err) {
      setError(userMessage(err, 'Failed to save changelog entry.'))
    } finally {
      setSaving(false)
    }
  }, [body, initial, onSaved, title])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{initial ? 'Edit Changelog Entry' : 'New Changelog Entry'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. v2.5 - Improved search"
            fullWidth
          />
          <Tabs value={tab} onChange={(_event, value: number) => setTab(value)}>
            <Tab label="Write" />
            <Tab label="Preview" />
          </Tabs>
          {tab === 0 ? (
            <TextField
              label="Body (Markdown)"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              multiline
              minRows={10}
              fullWidth
              placeholder={"## What's new\n\n- Feature A"}
              inputProps={{
                style: {
                  fontFamily: 'monospace',
                  fontSize: 13,
                },
              }}
            />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, minHeight: 220 }}>
              {body.trim() ? (
                <MarkdownContent markdown={body} />
              ) : (
                <Typography color="text.secondary" fontStyle="italic">
                  Nothing to preview yet.
                </Typography>
              )}
            </Paper>
          )}
          {initial && (
            <Typography variant="caption" color="text.secondary">
              Saving republishes the entry and resets the unread badge for all admin and instructor
              users.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={!title.trim() || !body.trim() || saving}
          startIcon={
            saving ? (
              <CircularProgress size={18} color="inherit" />
            ) : initial ? (
              <PublishIcon />
            ) : undefined
          }
        >
          {saving ? 'Saving...' : initial ? 'Republish' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function ChangelogAdmin() {
  const [entries, setEntries] = useState<ApiChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialogEntry, setDialogEntry] = useState<ApiChangelogEntry | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ApiChangelogEntry | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setEntries(await fetchChangelogEntries())
    } catch (err) {
      setLoadError(userMessage(err, 'Failed to load changelog entries.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const handleSaved = useCallback((saved: ApiChangelogEntry) => {
    setEntries((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.id === saved.id)
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = saved
        return next.sort((a, b) => b.published_at.localeCompare(a.published_at))
      }
      return [saved, ...prev].sort((a, b) => b.published_at.localeCompare(a.published_at))
    })
    setDialogEntry(undefined)
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteChangelogEntry(deleteTarget.id)
      setEntries((prev) => prev.filter((entry) => entry.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(userMessage(err, 'Failed to delete changelog entry.'))
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget])

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">Changelog</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setDialogEntry(null)}
        >
          New Entry
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Changelog entries support Markdown. Creating or republishing an entry shows the unread badge
        again for admin and instructor users.
      </Alert>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : entries.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" py={6}>
          No entries yet.
        </Typography>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Published</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  hover
                  onClick={() => setDialogEntry(entry)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{entry.title}</Typography>
                      {isNewEntry(entry.published_at) && (
                        <Chip label="new" size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(entry.published_at)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(entry.updated_at)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setDeleteTarget(entry)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <EntryDialog
        key={dialogEntry === undefined ? 'closed' : dialogEntry === null ? 'new' : dialogEntry.id}
        open={dialogEntry !== undefined}
        initial={dialogEntry ?? null}
        onClose={() => setDialogEntry(undefined)}
        onSaved={handleSaved}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete changelog entry?</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {deleteError && <Alert severity="error">{deleteError}</Alert>}
            <Typography>"{deleteTarget?.title}" will be permanently removed.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
