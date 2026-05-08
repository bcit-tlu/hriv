import { useState, useRef, useCallback, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import { ApiError } from '../api'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

const filter = createFilterOptions<string>()

interface AddCategoryDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (label: string) => void | Promise<void>
  currentDepth: number
  siblingNames?: string[]
}

export default function AddCategoryDialog({
  open,
  onClose,
  onAdd,
  currentDepth,
  siblingNames = [],
}: AddCategoryDialogProps) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const exactMatch = useMemo(
    () => siblingNames.some((s) => s.toLowerCase() === label.trim().toLowerCase()),
    [siblingNames, label],
  )

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
      if (err instanceof ApiError && err.status === 409) {
        setError('A category with this name already exists at this level')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth TransitionProps={{ onEntered: handleEntered }}>
      <DialogTitle>New Category (Level {currentDepth + 1})</DialogTitle>
      <DialogContent>
        <Autocomplete
          freeSolo
          options={siblingNames}
          filterOptions={(options, state) => {
            if (!state.inputValue) return []
            return filter(options, state)
          }}
          inputValue={label}
          onInputChange={(_e, value, reason) => {
            if (reason !== 'reset') setLabel(value)
          }}
          disableClearable
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={inputRef}
              autoFocus
              margin="dense"
              label="Category name"
              fullWidth
              variant="outlined"
              helperText={exactMatch ? 'This name already exists at this level' : undefined}
              error={exactMatch}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSubmit()
                }
              }}
            />
          )}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!label.trim() || saving}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
