import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Program } from '../types'

interface BulkEditModalProps {
  open: boolean
  onClose: () => void
  onSave: (programIds: number[]) => void | Promise<void>
  programs: Program[]
  selectedCount: number
}

export default function BulkEditModal({
  open,
  onClose,
  onSave,
  programs,
  selectedCount,
}: BulkEditModalProps) {
  const [programIds, setProgramIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const handleProgramChange = (e: SelectChangeEvent<number[]>) => {
    const val = e.target.value
    setProgramIds(typeof val === 'string' ? [] : val)
  }

  // Identifies the latest save so a stale in-flight completion (after the
  // dialog was dismissed and reopened) cannot clobber newer state.
  const saveTokenRef = useRef(0)

  const handleSave = async () => {
    if (saving) return
    const token = ++saveTokenRef.current
    setSaving(true)
    try {
      await onSave(programIds)
      if (saveTokenRef.current === token) {
        setProgramIds([])
      }
    } catch {
      return
    } finally {
      if (saveTokenRef.current === token) {
        setSaving(false)
      }
    }
  }

  const handleClose = () => {
    saveTokenRef.current++
    setSaving(false)
    setProgramIds([])
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Bulk Edit Programs</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Assign programs to {selectedCount} selected {selectedCount === 1 ? 'person' : 'people'}.
        </Typography>
        <Typography variant="body2" color="warning.main">
          This will replace any existing program associations for the selected{' '}
          {selectedCount === 1 ? 'person' : 'people'}.
        </Typography>
        <FormControl fullWidth>
          <InputLabel id="bulk-edit-program-label">Programs</InputLabel>
          <Select
            multiple
            labelId="bulk-edit-program-label"
            value={programIds}
            onChange={handleProgramChange}
            input={<OutlinedInput label="Programs" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((id) => {
                  const prog = programs.find((p) => p.id === id)
                  return <Chip key={id} label={prog?.name ?? id} size="small" color="primary" />
                })}
              </Box>
            )}
          >
            {programs.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} aria-hidden /> : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
