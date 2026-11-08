import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { ApiError, mintPasswordSetupLink, userMessage } from '../api'

export default function PasswordSetupLinkDialog({
  user,
  onClose,
  passwordCleared = false,
}: {
  user: { id: number; name: string; active: boolean }
  onClose: () => void
  passwordCleared?: boolean
}) {
  const [attempt, setAttempt] = useState(passwordCleared || !user.active ? 0 : 1)
  const [busy, setBusy] = useState(!passwordCleared && user.active)
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!attempt) return
    let cancelled = false
    mintPasswordSetupLink(user.id)
      .then((data) => {
        if (cancelled) return
        setLink({
          url: `${window.location.origin}/#password_setup=${encodeURIComponent(data.setup_token)}`,
          expiresAt: data.expires_at,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof ApiError && err.status === 409
            ? 'This account already has a password. Clear it before creating a setup link.'
            : err instanceof ApiError && err.detail === 'oidc_linked'
              ? 'Managed by the identity provider'
              : err instanceof ApiError && err.detail === 'account_inactive'
                ? 'Activate this account before creating a setup link.'
                : userMessage(
                    err,
                    'Could not create a setup link. Retry here or from the person’s row.',
                  ),
        )
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt, user.id])

  const copy = async () => {
    if (!link) return
    setError(null)
    const fallback = () => {
      const input = document.createElement('input')
      input.value = link.url
      document.body.appendChild(input)
      try {
        input.select()
        if (!document.execCommand('copy')) throw new Error('Copy unavailable')
      } finally {
        input.remove()
      }
    }
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(link.url)
        } catch {
          fallback()
        }
      } else fallback()
      setCopied(true)
    } catch {
      setError('Could not copy the link. Select the URL and copy it manually.')
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="setup-link-title">
      <DialogTitle id="setup-link-title">Password-setup link</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography>Create a password-setup link for {user.name}.</Typography>
        <Typography variant="body2" color="text.secondary">
          The account already exists. If link creation fails, retry here or close and retry from the
          person’s row.
        </Typography>
        <Alert severity="warning">
          This link is a credential and works only once. Send it privately to this person. Creating
          another link replaces the previous one.
        </Alert>
        {passwordCleared && (
          <Alert severity="success">
            Password cleared. Create a new setup link so this person can choose a password.
          </Alert>
        )}
        {!user.active && (
          <Alert severity="info">Activate this account before creating a setup link.</Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {busy && <CircularProgress size={24} aria-label="Creating setup link" />}
        {link && (
          <>
            <TextField
              label="Setup URL"
              value={link.url}
              fullWidth
              multiline
              slotProps={{ input: { readOnly: true } }}
            />
            <Typography variant="body2" color="text.secondary">
              Expires: {new Date(link.expiresAt).toLocaleString()}
            </Typography>
            {copied && <Alert severity="success">Link copied to clipboard.</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {link ? (
          <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => void copy()}>
            Copy link
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || !user.active}
            onClick={() => {
              setBusy(true)
              setError(null)
              setAttempt((value) => value + 1)
            }}
          >
            {attempt ? 'Retry' : 'Create setup link'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
