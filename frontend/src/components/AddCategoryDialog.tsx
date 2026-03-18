import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface AddCategoryDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (label: string) => void
  currentDepth: number
}

export default function AddCategoryDialog({
  open,
  onClose,
  onAdd,
  currentDepth,
}: AddCategoryDialogProps) {
  const [label, setLabel] = useState('')

  const handleClose = () => {
    setLabel('')
    onClose()
  }

  const handleSubmit = () => {
    const trimmed = label.trim()
    if (trimmed) {
      onAdd(trimmed)
      handleClose()
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Category (Level {currentDepth + 1})</DialogTitle>
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
        <Button onClick={handleSubmit} variant="contained" disabled={!label.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
