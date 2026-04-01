import { useState, useCallback } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface EditCategoryDialogProps {
  open: boolean
  onClose: () => void
  onSave: (newLabel: string) => void
  currentLabel: string
}

export default function EditCategoryDialog({
  open,
  onClose,
  onSave,
  currentLabel,
}: EditCategoryDialogProps) {
  const [label, setLabel] = useState(currentLabel)

  const handleEnter = useCallback(() => {
    setLabel(currentLabel)
  }, [currentLabel])

  const handleClose = () => {
    setLabel('')
    onClose()
  }

  const handleSubmit = () => {
    const trimmed = label.trim()
    if (trimmed && trimmed !== currentLabel) {
      onSave(trimmed)
      handleClose()
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
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!label.trim() || label.trim() === currentLabel}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
