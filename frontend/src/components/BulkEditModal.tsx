import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Program } from '../types'

interface BulkEditModalProps {
  open: boolean
  onClose: () => void
  onSave: (programId: number | null) => void
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
  const [programId, setProgramId] = useState<number | ''>('')

  const handleProgramChange = (e: SelectChangeEvent<number | ''>) => {
    setProgramId(e.target.value as number | '')
  }

  const handleSave = () => {
    onSave(programId === '' ? null : programId)
    setProgramId('')
  }

  const handleClose = () => {
    setProgramId('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Bulk Edit Program</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          Assign a program to {selectedCount} selected{' '}
          {selectedCount === 1 ? 'person' : 'people'}.
        </Typography>
        <FormControl fullWidth>
          <InputLabel>Program</InputLabel>
          <Select
            value={programId}
            label="Program"
            onChange={handleProgramChange}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
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
        <Button onClick={handleSave} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
