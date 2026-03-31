import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category } from '../types'

interface BulkEditImagesModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: {
    category_id?: number | null
    copyright?: string
    origin?: string
    program?: string
    active?: boolean
  }) => void
  onDelete: () => void
  categories: Category[]
  selectedCount: number
}

export default function BulkEditImagesModal({
  open,
  onClose,
  onSave,
  onDelete,
  categories,
  selectedCount,
}: BulkEditImagesModalProps) {
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [copyright, setCopyright] = useState('')
  const [origin, setOrigin] = useState('')
  const [program, setProgram] = useState('')
  const [active, setActive] = useState(true)
  const [activeChanged, setActiveChanged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const resetForm = useCallback(() => {
    setCategoryId(null)
    setCopyright('')
    setOrigin('')
    setProgram('')
    setActive(true)
    setActiveChanged(false)
    setConfirmDelete(false)
  }, [])

  const handleEnter = useCallback(() => {
    resetForm()
  }, [resetForm])

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSave = () => {
    const data: {
      category_id?: number | null
      copyright?: string
      origin?: string
      program?: string
      active?: boolean
    } = {}
    if (categoryId !== null) data.category_id = categoryId
    if (copyright.trim()) data.copyright = copyright.trim()
    if (origin.trim()) data.origin = origin.trim()
    if (program.trim()) data.program = program.trim()
    if (activeChanged) data.active = active
    onSave(data)
    resetForm()
  }

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete()
    resetForm()
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
            onChange={setCategoryId}
            label="Move to Category"
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
          label="Origin"
          fullWidth
          variant="outlined"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <TextField
          label="Program"
          fullWidth
          variant="outlined"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
        />
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
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  )
}
