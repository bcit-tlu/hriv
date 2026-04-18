import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

export type ConfirmImportKind = 'db_import' | 'files_import'

interface ConfirmImportDialogProps {
  open: boolean
  kind: ConfirmImportKind
  file: File | null
  onCancel: () => void
  onConfirm: () => void
}

const KIND_COPY: Record<
  ConfirmImportKind,
  { title: string; replaces: string; verb: string }
> = {
  db_import: {
    title: 'Import database?',
    replaces:
      'all categories, images, users, and source image records currently in the database',
    verb: 'overwritten',
  },
  files_import: {
    title: 'Import filesystem?',
    replaces:
      'all image tiles, thumbnails, and uploaded source files currently on disk',
    verb: 'overwritten',
  },
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

export default function ConfirmImportDialog(props: ConfirmImportDialogProps) {
  // Render the body in a keyed child so that every ``open`` transition
  // remounts it and resets ``backupVerified`` to ``false``. This keeps
  // the "confirm each import" safety invariant without calling
  // ``setState`` inside a ``useEffect`` (which react-hooks/set-state-in-effect
  // flags as a cascading render).
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      maxWidth="sm"
      fullWidth
      aria-labelledby="confirm-import-title"
    >
      <ConfirmImportDialogBody key={String(props.open)} {...props} />
    </Dialog>
  )
}

function ConfirmImportDialogBody({
  kind,
  file,
  onCancel,
  onConfirm,
}: ConfirmImportDialogProps) {
  const [backupVerified, setBackupVerified] = useState(false)
  const copy = KIND_COPY[kind]

  return (
    <>
      <DialogTitle id="confirm-import-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningAmberIcon color="warning" aria-hidden />
        {copy.title}
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will replace {copy.replaces}. The operation cannot be undone —
          any data not included in the archive will be {copy.verb}.
        </Alert>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Selected archive:
        </Typography>
        <Box
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            wordBreak: 'break-all',
          }}
        >
          <div>{file?.name ?? '(no file selected)'}</div>
          <div style={{ opacity: 0.7 }}>
            {file ? formatBytes(file.size) : ''}
          </div>
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={backupVerified}
              onChange={(e) => setBackupVerified(e.target.checked)}
              inputProps={{ 'aria-label': 'I have verified a recent backup exists' }}
            />
          }
          label="I have verified a recent backup exists"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color="warning"
          disabled={!backupVerified || !file}
        >
          I understand, proceed
        </Button>
      </DialogActions>
    </>
  )
}
