import { useCallback, useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { listSourceImages, userMessage, type ApiSourceImage } from '../api'
import { loadDismissedFailedUploads, saveDismissedFailedUploads } from '../dismissedFailedUploads'

/** Failed source images listed in the dialog, newest first. */
export const FAILED_UPLOADS_LIMIT = 200

interface FailedUploadsDialogProps {
  open: boolean
  onClose: () => void
  /** Also drop the matching failure snackbar when a row is dismissed. */
  onDismiss?: (sourceImageId: number) => void
}

/**
 * Durable record of source images whose processing failed, with the persisted
 * failure reason. Available independently of the transient failure snackbars.
 */
export default function FailedUploadsDialog({
  open,
  onClose,
  onDismiss,
}: FailedUploadsDialogProps) {
  const [failures, setFailures] = useState<ApiSourceImage[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set<number>())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Discards responses from a superseded load (e.g. reopen while one is in flight).
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setError(null)
    setDismissed(loadDismissedFailedUploads())
    try {
      const rows = await listSourceImages({ status: 'failed', limit: FAILED_UPLOADS_LIMIT })
      if (seq !== loadSeqRef.current) return
      setFailures(rows)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setError(userMessage(err, 'Failed to load failed uploads'))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  const dismiss = useCallback(
    (ids: number[]) => {
      setDismissed((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.add(id))
        saveDismissedFailedUploads(next)
        return next
      })
      ids.forEach((id) => onDismiss?.(id))
    },
    [onDismiss],
  )

  const undismissed = failures.filter((src) => !dismissed.has(src.id))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch trigger when the dialog opens
    if (open) void load()
  }, [open, load])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Failed uploads</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {!loading && error && <Alert severity="error">{error}</Alert>}
        {!loading && !error && failures.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No failed uploads.
          </Typography>
        )}
        {!loading && !error && failures.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>File</TableCell>
                <TableCell>Failed</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {failures.map((src) => (
                <TableRow key={src.id}>
                  <TableCell sx={{ wordBreak: 'break-all' }}>{src.original_filename}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {new Date(src.updated_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{src.error_message ?? 'Processing failed.'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {dismissed.has(src.id) ? (
                      <Typography variant="body2" color="text.secondary">
                        Dismissed
                      </Typography>
                    ) : (
                      <Button size="small" onClick={() => dismiss([src.id])}>
                        Dismiss
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        {undismissed.length > 0 && (
          <Button onClick={() => dismiss(undismissed.map((src) => src.id))}>Dismiss all</Button>
        )}
        <Button onClick={load} disabled={loading}>
          Refresh
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
