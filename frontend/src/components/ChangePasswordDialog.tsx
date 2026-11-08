import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changePassword } from '../api'
import { newPasswordError, passwordErrorMessage } from '../passwordErrors'
import { LoginLayout } from './LoginScreen'

interface PasswordChangeProps {
  onSuccess: () => Promise<void>
  onCancel: () => void
  cancelLabel?: string
}

export function PasswordChangeForm({
  onSuccess,
  onCancel,
  cancelLabel = 'Cancel',
}: PasswordChangeProps) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const validation = newPasswordError(password, confirm)

  const submit = async () => {
    if (busy || (!changed && (!current || validation))) return
    setBusy(true)
    setError(null)
    let passwordSaved = changed
    try {
      if (!changed) {
        await changePassword(current, password)
        passwordSaved = true
        setChanged(true)
        setCurrent('')
        setPassword('')
        setConfirm('')
      }
      await onSuccess()
    } catch (err) {
      setError(
        passwordSaved
          ? 'Your password was changed, but your session could not be refreshed. Please retry or sign out.'
          : passwordErrorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      component="form"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {error && <Alert severity="error">{error}</Alert>}
      {changed ? (
        <Typography>Your password has been changed. Refresh your session to continue.</Typography>
      ) : (
        <>
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={busy}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            helperText="At least 8 characters, at most 72 UTF-8 bytes."
            slotProps={{
              formHelperText: { sx: { '&.Mui-disabled': { color: 'text.secondary' } } },
            }}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
            error={Boolean(confirm && validation)}
            helperText={confirm && validation ? validation : undefined}
          />
        </>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || (!changed && (!current || Boolean(validation)))}
          startIcon={
            busy ? (
              <CircularProgress size={18} color="inherit" aria-label="Saving password" />
            ) : undefined
          }
        >
          {busy ? 'Saving…' : changed ? 'Refresh session' : 'Change password'}
        </Button>
      </Box>
    </Box>
  )
}

export default function ChangePasswordDialog({
  open,
  onSuccess,
  onClose,
}: {
  open: boolean
  onSuccess: () => Promise<void>
  onClose: () => void
}) {
  return (
    <Dialog open={open} aria-labelledby="change-password-title" fullWidth maxWidth="xs">
      <DialogTitle id="change-password-title">Change password</DialogTitle>
      <DialogContent>
        <PasswordChangeForm onSuccess={onSuccess} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  )
}

export function ForcedPasswordChangeScreen({
  onSuccess,
  onSignOut,
}: {
  onSuccess: () => Promise<void>
  onSignOut: () => void
}) {
  return (
    <LoginLayout title="Change your password">
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Your administrator requires a password change before you can continue.
      </Typography>
      <PasswordChangeForm onSuccess={onSuccess} onCancel={onSignOut} cancelLabel="Sign out" />
    </LoginLayout>
  )
}
