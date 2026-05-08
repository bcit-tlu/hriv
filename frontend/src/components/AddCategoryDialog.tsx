import { useState, useRef, useCallback } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface AddCategoryDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (label: string) => void | Promise<void>
  currentDepth: number
}

export default function AddCategoryDialog({
  open,
  onClose,
  onAdd,
  currentDepth,
}: AddCategoryDialogProps) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleEntered = useCallback(() => {
    // Use a ref + onEntered to reliably focus when stacked inside another dialog
    inputRef.current?.focus()
  }, [])

  const handleClose = () => {
    setLabel('')
    setError(null)
    onClose()
  }

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await onAdd(trimmed)
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
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth TransitionProps={{ onEntered: handleEntered }}>
      <DialogTitle>New Category (Level {currentDepth + 1})</DialogTitle>
      <DialogContent>
        <TextField
          inputRef={inputRef}
          autoFocus
          margin="dense"
          label="Category name"
          fullWidth
          variant="outlined"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              handleSubmit()
            }
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
        <Button onClick={handleSubmit} variant="contained" disabled={!label.trim() || saving}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
