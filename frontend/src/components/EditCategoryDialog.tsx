import { useState, useEffect, useRef, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { ApiError } from '../api'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Program } from '../types'

const filter = createFilterOptions<string>()

interface EditCategoryDialogProps {
  open: boolean
  onClose: () => void
  onSave: (newLabel: string, programIds?: number[]) => void | Promise<void>
  currentLabel: string
  siblingNames?: string[]
  programs?: Program[]
  currentProgramIds?: number[]
  /** Program IDs inherited from ancestor categories (read-only display). */
  inheritedProgramIds?: number[]
}

export default function EditCategoryDialog({
  open,
  onClose,
  onSave,
  currentLabel,
  siblingNames = [],
  programs = [],
  currentProgramIds = [],
  inheritedProgramIds = [],
}: EditCategoryDialogProps) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [visibility, setVisibility] = useState<'all' | 'specific'>('all')
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<number>>(new Set())

  // Populate state from props when dialog opens (false → true transition only)
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setLabel(currentLabel)
      setError(null)
      setVisibility(currentProgramIds.length > 0 ? 'specific' : 'all')
      setSelectedProgramIds(new Set(currentProgramIds))
    }
    prevOpen.current = open
  })

  const exactMatch = useMemo(
    () =>
      label.trim().toLowerCase() !== currentLabel.toLowerCase() &&
      siblingNames.some((s) => s.toLowerCase() === label.trim().toLowerCase()),
    [siblingNames, label, currentLabel],
  )

  const handleClose = () => {
    setLabel('')
    setError(null)
    setVisibility('all')
    setSelectedProgramIds(new Set())
    onClose()
  }

  const toggleProgram = (programId: number) => {
    setSelectedProgramIds((prev) => {
      const next = new Set(prev)
      if (next.has(programId)) {
        next.delete(programId)
      } else {
        next.add(programId)
      }
      return next
    })
  }

  const programsChanged = useMemo(() => {
    const currentSet = new Set(currentProgramIds)
    const effectiveIds = visibility === 'specific' ? selectedProgramIds : new Set<number>()
    if (currentSet.size !== effectiveIds.size) return true
    for (const id of effectiveIds) {
      if (!currentSet.has(id)) return true
    }
    return false
  }, [currentProgramIds, selectedProgramIds, visibility])

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const labelChanged = trimmed !== currentLabel
    if (!labelChanged && !programsChanged) return
    const programIds = programs.length > 0
      ? (visibility === 'specific' ? Array.from(selectedProgramIds) : [])
      : undefined
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed, programIds)
      setLabel('')
      setVisibility('all')
      setSelectedProgramIds(new Set())
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

  const labelChanged = label.trim() !== '' && label.trim() !== currentLabel

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit Category</DialogTitle>
      <DialogContent>
        <Autocomplete
          freeSolo
          options={siblingNames}
          filterOptions={(options, state) => {
            if (!state.inputValue) return []
            return filter(options, state).filter(
              (o) => o.toLowerCase() !== currentLabel.toLowerCase(),
            )
          }}
          inputValue={label}
          onInputChange={(_e, value, reason) => {
            if (reason !== 'reset') setLabel(value)
          }}
          disableClearable
          renderInput={(params) => (
            <TextField
              {...params}
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
        {programs.length > 0 && inheritedProgramIds.length === 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Visible to
            </Typography>
            <RadioGroup
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'all' | 'specific')}
            >
              <FormControlLabel value="all" control={<Radio size="small" />} label="All students" />
              <FormControlLabel value="specific" control={<Radio size="small" />} label="Specific programs" />
            </RadioGroup>
            {visibility === 'specific' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {programs.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    size="small"
                    color={selectedProgramIds.has(p.id) ? 'primary' : 'default'}
                    variant={selectedProgramIds.has(p.id) ? 'filled' : 'outlined'}
                    onClick={() => toggleProgram(p.id)}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}
        {inheritedProgramIds.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Restricted by parent category
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {inheritedProgramIds.map((pid) => {
                const prog = programs.find((p) => p.id === pid)
                return prog ? (
                  <Chip
                    key={pid}
                    label={prog.name}
                    size="small"
                    color="primary"
                    variant="filled"
                    sx={{ opacity: 0.5 }}
                  />
                ) : null
              })}
            </Box>
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!label.trim() || (!labelChanged && !programsChanged) || (visibility === 'specific' && selectedProgramIds.size === 0 && programs.length > 0) || saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
