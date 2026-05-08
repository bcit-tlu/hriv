import { useState, useCallback } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface EditCategoryDialogProps {
  open: boolean
  onClose: () => void
  onSave: (newLabel: string) => void | Promise<void>
  currentLabel: string
}

export default function EditCategoryDialog({
  open,
  onClose,
  onSave,
  currentLabel,
}: EditCategoryDialogProps) {
  const [label, setLabel] = useState(currentLabel)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleEnter = useCallback(() => {
    setLabel(currentLabel)
    setError(null)
  }, [currentLabel])

  const handleClose = () => {
    setLabel('')
    setError(null)
    onClose()
  }

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed || trimmed === currentLabel) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setLabel('')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('409')) {
        setError('A category with this name already exists at this level')
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Rename Category</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Category name"
          fullWidth
          variant="outlined"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!label.trim() || label.trim() === currentLabel || saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
