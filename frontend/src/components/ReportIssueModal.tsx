import { useState, useRef, useEffect } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import { reportIssue, userMessage } from '../api'
import type { FrontendPage } from '../observability'
import { emitEvent } from '../observability'

interface ReportIssueModalProps {
  open: boolean
  onClose: () => void
  page: FrontendPage
  onSuccess?: (message: string, trackingUrl?: string | null) => void
  onError?: (message: string) => void
}

export const AUTO_CLOSE_DELAY_MS = 2000

function safeTrackingUrl(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null
  } catch {
    return null
  }
}

export default function ReportIssueModal({
  open,
  onClose,
  page,
  onSuccess,
  onError,
}: ReportIssueModalProps) {
  const [description, setDescription] = useState('')
  const [feedbackType, setFeedbackType] = useState<'problem_or_issue' | 'comment_or_suggestion'>(
    'problem_or_issue',
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasEmittedOpenRef = useRef(false)
  const busy = submitting || submitted

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) {
      hasEmittedOpenRef.current = false
      return
    }
    if (hasEmittedOpenRef.current) return
    hasEmittedOpenRef.current = true
    emitEvent({
      event: 'feedback.report_issue_opened',
      action: 'open',
      outcome: 'success',
      page,
    })
  }, [open, page])

  const handleClose = () => {
    if (submitting) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setDescription('')
    setFeedbackType('problem_or_issue')
    setSubmitted(false)
    onClose()
  }

  const handleDialogClose = (_event: object, reason: 'backdropClick' | 'escapeKeyDown') => {
    if (submitting) return
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      handleClose()
    }
  }

  const handleSubmit = async () => {
    const trimmed = description.trim()
    if (!trimmed) return

    setSubmitting(true)
    const startedAt = performance.now()

    try {
      const result = await reportIssue({
        description: trimmed,
        page_url: window.location.href,
        feedback_type: feedbackType,
      })
      emitEvent({
        event: 'feedback.report_issue_submitted',
        action: 'submit',
        outcome: 'success',
        duration_ms: Math.round(performance.now() - startedAt),
        page,
      })
      const safeUrl = safeTrackingUrl(result.tracking_url)
      onSuccess?.('Thanks! Your feedback has been received.', safeUrl)
      setSubmitted(true)
      setDescription('')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        handleClose()
      }, AUTO_CLOSE_DELAY_MS)
    } catch (err) {
      emitEvent({
        event: 'feedback.report_issue_submitted',
        action: 'submit',
        outcome: 'failure',
        duration_ms: Math.round(performance.now() - startedAt),
        page,
      })
      onError?.(userMessage(err, 'Failed to send feedback. Please try again later.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleDialogClose} maxWidth="sm" fullWidth>
      <DialogTitle>Send Feedback</DialogTitle>
      <DialogContent>
        <FormControl component="fieldset" sx={{ mb: 2, mt: 1 }} disabled={busy}>
          <FormLabel component="legend">What kind of feedback is this?</FormLabel>
          <RadioGroup
            aria-label="Feedback type"
            name="feedback_type"
            value={feedbackType}
            onChange={(e) =>
              setFeedbackType(e.target.value as 'problem_or_issue' | 'comment_or_suggestion')
            }
          >
            <FormControlLabel
              value="problem_or_issue"
              control={<Radio />}
              label="Problem or issue"
            />
            <FormControlLabel
              value="comment_or_suggestion"
              control={<Radio />}
              label="Comment or suggestion"
            />
          </RadioGroup>
        </FormControl>
        <TextField
          autoFocus
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          label="Please describe your feedback"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          {submitted ? 'Close' : 'Cancel'}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={busy || !description.trim()}>
          {submitting ? <CircularProgress size={20} /> : submitted ? 'Sent' : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
