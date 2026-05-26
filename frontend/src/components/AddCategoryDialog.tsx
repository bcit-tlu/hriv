import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
const EMPTY_IDS: number[] = []

interface AddCategoryDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (label: string, programIds: number[]) => void | Promise<void>
  parentLabel?: string
  siblingNames?: string[]
  programs?: Program[]
  /** Effective inherited program IDs from ancestors (narrowing semantics). */
  inheritedProgramIds?: number[]
}

export default function AddCategoryDialog({
  open,
  onClose,
  onAdd,
  parentLabel,
  siblingNames = [],
  programs = [],
  inheritedProgramIds = EMPTY_IDS,
}: AddCategoryDialogProps) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [visibility, setVisibility] = useState<'all' | 'specific'>('all')
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // Pre-populate with parent restrictions when dialog opens
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setLabel('')
      setError(null)
      setSaving(false)
      if (inheritedProgramIds.length > 0) {
        setVisibility('specific')
        setSelectedProgramIds(new Set(inheritedProgramIds))
      } else {
        setVisibility('all')
        setSelectedProgramIds(new Set())
      }
    }
    prevOpen.current = open
  }, [open, inheritedProgramIds])

  const exactMatch = useMemo(
    () => siblingNames.some((s) => s.toLowerCase() === label.trim().toLowerCase()),
    [siblingNames, label],
  )

  const handleEntered = useCallback(() => {
    inputRef.current?.focus()
  }, [])

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

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const programIds = visibility === 'specific' ? Array.from(selectedProgramIds) : []
    setSaving(true)
    setError(null)
    try {
      await onAdd(trimmed, programIds)
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

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth TransitionProps={{ onEntered: handleEntered }}>
      <DialogTitle>{parentLabel ? `New Category in ${parentLabel}` : 'New Category'}</DialogTitle>
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
        {programs.length > 0 && (
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
                {programs.map((p) => {
                  const disabled = inheritedProgramIds.length > 0 && !inheritedProgramIds.includes(p.id)
                  const isInheritedOnly = inheritedProgramIds.includes(p.id) && !selectedProgramIds.has(p.id)
                  return (
                    <Chip
                      key={p.id}
                      label={p.name}
                      size="small"
                      color={selectedProgramIds.has(p.id) || isInheritedOnly ? 'primary' : 'default'}
                      variant={selectedProgramIds.has(p.id) || isInheritedOnly ? 'filled' : 'outlined'}
                      onClick={disabled ? undefined : () => toggleProgram(p.id)}
                      disabled={disabled}
                      sx={isInheritedOnly ? { opacity: 0.5 } : undefined}
                    />
                  )
                })}
              </Box>
            )}
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
        <Button onClick={handleSubmit} variant="contained" disabled={!label.trim() || (visibility === 'specific' && selectedProgramIds.size === 0) || saving}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
