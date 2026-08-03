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
import type { Group } from '../types'

interface BulkGroupModalProps {
  open: boolean
  onClose: () => void
  // Resolves with the group ids that failed (empty/void on full success) so
  // the modal can prune succeeded groups from the selection for retry.
  onSave: (groupIds: number[]) => Promise<number[] | void>
  groups: Group[]
  selectedCount: number
}

export default function BulkGroupModal({
  open,
  onClose,
  onSave,
  groups,
  selectedCount,
}: BulkGroupModalProps) {
  const [groupIds, setGroupIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const handleGroupChange = (e: SelectChangeEvent<number[]>) => {
    const val = e.target.value
    setGroupIds(typeof val === 'string' ? [] : val)
  }

  // Identifies the latest save so a stale in-flight completion (after the
  // dialog was dismissed and reopened) cannot clobber newer state.
  const saveTokenRef = useRef(0)

  const handleSave = async () => {
    if (saving) return
    const token = ++saveTokenRef.current
    setSaving(true)
    try {
      const failedGroupIds = await onSave(groupIds)
      if (saveTokenRef.current === token) {
        setGroupIds(failedGroupIds && failedGroupIds.length > 0 ? failedGroupIds : [])
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
    setGroupIds([])
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Bulk Add to Groups</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Add {selectedCount} selected {selectedCount === 1 ? 'person' : 'people'} to one or more
          groups.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Existing group memberships are preserved; only the selected groups are added.
        </Typography>
        <FormControl fullWidth>
          <InputLabel id="bulk-group-label">Groups</InputLabel>
          <Select
            multiple
            labelId="bulk-group-label"
            value={groupIds}
            onChange={handleGroupChange}
            input={<OutlinedInput label="Groups" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((id) => {
                  const grp = groups.find((g) => g.id === id)
                  return <Chip key={id} label={grp?.name ?? id} size="small" color="secondary" />
                })}
              </Box>
            )}
          >
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
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
          disabled={groupIds.length === 0 || saving}
          startIcon={
            saving ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined
          }
        >
          {saving ? 'Adding…' : 'Add to Groups'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
