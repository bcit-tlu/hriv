import { useState, useRef, useCallback } from 'react'
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
  const inputRef = useRef<HTMLInputElement>(null)

  const handleEntered = useCallback(() => {
    // Use a ref + onEntered to reliably focus when stacked inside another dialog
    inputRef.current?.focus()
  }, [])

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
