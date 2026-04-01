import { useState, useRef, useEffect } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import { reportIssue } from '../api'

interface ReportIssueModalProps {
  open: boolean
  onClose: () => void
}

export default function ReportIssueModal({ open, onClose }: ReportIssueModalProps) {
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const handleClose = () => {
    if (submitting) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setDescription('')
    setError('')
    setSuccess('')
    onClose()
  }

  const handleSubmit = async () => {
    const trimmed = description.trim()
    if (!trimmed) {
      setError('Please describe the issue or suggestion.')
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const result = await reportIssue({
        description: trimmed,
        page_url: window.location.href,
      })
      setSuccess(`Issue created successfully.`)
      setDescription('')
      // Auto-close after a short delay
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setSuccess('')
        handleClose()
      }, 2000)
      void result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Report an Issue</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}
        <TextField
          autoFocus
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          label="Did you notice an issue or have a suggestion?"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            if (error) setError('')
          }}
          disabled={submitting}
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || !description.trim()}
        >
          {submitting ? <CircularProgress size={20} /> : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
