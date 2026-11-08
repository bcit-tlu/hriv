import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { LoginLayout } from './LoginScreen'
import { newPasswordError, passwordErrorMessage } from '../passwordErrors'

interface PasswordSetupScreenProps {
  onSubmit: (password: string) => Promise<void>
  onSignIn: () => void
}

export default function PasswordSetupScreen({ onSubmit, onSignIn }: PasswordSetupScreenProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validation = newPasswordError(password, confirm)

  return (
    <LoginLayout title="Set your password">
      <Box
        component="form"
        sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        onSubmit={async (event) => {
          event.preventDefault()
          if (busy || validation) return
          setBusy(true)
          setError(null)
          try {
            await onSubmit(password)
          } catch (err) {
            setError(passwordErrorMessage(err, true))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Typography color="text.secondary">
          Create a password for your guest account to sign in.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          helperText="At least 8 characters, at most 72 UTF-8 bytes."
          slotProps={{ formHelperText: { sx: { '&.Mui-disabled': { color: 'text.secondary' } } } }}
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
        <Button
          type="submit"
          variant="contained"
          disabled={busy || Boolean(validation)}
          startIcon={
            busy ? (
              <CircularProgress size={18} color="inherit" aria-label="Setting password" />
            ) : undefined
          }
        >
          {busy ? 'Setting password…' : 'Set password'}
        </Button>
        <Button onClick={onSignIn} disabled={busy}>
          Sign in instead
        </Button>
      </Box>
    </LoginLayout>
  )
}
