import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category, Program } from '../types'

interface BulkEditImagesModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: {
    category_id?: number | null
    copyright?: string
    note?: string
    program_ids?: number[]
    active?: boolean
  }) => Promise<void>
  onDelete: () => Promise<void>
  categories: Category[]
  programs: Program[]
  selectedCount: number
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
}

export default function BulkEditImagesModal({
  open,
  onClose,
  onSave,
  onDelete,
  categories,
  programs,
  selectedCount,
  onAddCategory,
}: BulkEditImagesModalProps) {
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryChanged, setCategoryChanged] = useState(false)
  const [copyright, setCopyright] = useState('')
  const [note, setNote] = useState('')
  const [programIds, setProgramIds] = useState<number[]>([])
  const [programChanged, setProgramChanged] = useState(false)
  const [active, setActive] = useState(true)
  const [activeChanged, setActiveChanged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const resetForm = useCallback(() => {
    setCategoryId(null)
    setCategoryChanged(false)
    setCopyright('')
    setNote('')
    setProgramIds([])
    setProgramChanged(false)
    setActive(true)
    setActiveChanged(false)
    setConfirmDelete(false)
    setSaving(false)
  }, [])

  const handleEnter = useCallback(() => {
    resetForm()
  }, [resetForm])

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const value = event.target.value
    setProgramIds(typeof value === 'string' ? [] : value)
    setProgramChanged(true)
  }

  const handleSave = async () => {
    const data: {
      category_id?: number | null
      copyright?: string
      note?: string
      program_ids?: number[]
      active?: boolean
    } = {}
    if (categoryChanged) data.category_id = categoryId
    if (copyright.trim()) data.copyright = copyright.trim()
    if (note.trim()) data.note = note.trim()
    if (programChanged) data.program_ids = programIds
    if (activeChanged) data.active = active
    setSaving(true)
    try {
      await onSave(data)
      resetForm()
    } catch {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    try {
      await onDelete()
      resetForm()
    } catch {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
    >
      <DialogTitle>Bulk Edit Images</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Editing {selectedCount} selected{' '}
          {selectedCount === 1 ? 'image' : 'images'}. Only fields you fill in
          will be updated.
        </Typography>

        <Box>
          <CategoryPickerSelect
            categories={categories}
            value={categoryId}
            onChange={(id) => {
              setCategoryId(id)
              setCategoryChanged(true)
            }}
            label="Move to Category"
            onAddCategory={onAddCategory}
          />
        </Box>
        <TextField
          label="Copyright"
          fullWidth
          variant="outlined"
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
        />
        <TextField
          label="Note"
          fullWidth
          variant="outlined"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <FormControl fullWidth>
          <InputLabel id="bulk-program-select-label">Program</InputLabel>
          <Select
            labelId="bulk-program-select-label"
            multiple
            value={programIds}
            onChange={handleProgramChange}
            input={<OutlinedInput label="Program" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((id) => {
                  const prog = programs.find((p) => p.id === id)
                  return <Chip key={id} label={prog?.name ?? id} size="small" />
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
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Multiple programs can be selected.
          </Typography>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              checked={active}
              onChange={(e) => {
                setActive(e.target.checked)
                setActiveChanged(true)
              }}
            />
          }
          label="Active (visible to students)"
        />

        <Divider />

        {/* Delete */}
        <Box>
          <Button
            color="error"
            variant={confirmDelete ? 'contained' : 'outlined'}
            onClick={handleDelete}
            disabled={saving}
            fullWidth
          >
            {confirmDelete
              ? `Confirm Delete ${selectedCount} ${selectedCount === 1 ? 'Image' : 'Images'}`
              : `Delete ${selectedCount} Selected ${selectedCount === 1 ? 'Image' : 'Images'}`}
          </Button>
          {confirmDelete && (
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone. Click again to confirm.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
