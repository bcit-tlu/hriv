import { useState, useCallback } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Snackbar from '@mui/material/Snackbar'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category, Program } from '../types'

interface BulkEditImagesModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: {
    category_id?: number | null
    copyright?: string
    note?: string
    active?: boolean
  }) => Promise<void>
  onDelete: () => Promise<void>
  categories: Category[]
  selectedCount: number
  programs?: Program[]
  onAddCategory?: (label: string, parentId: number | null, programIds?: number[]) => Promise<number | void>
  onEditCategory?: (categoryId: number, newLabel: string, programIds?: number[]) => Promise<void>
  onToggleVisibility?: (categoryId: number) => Promise<void>
}

export default function BulkEditImagesModal({
  open,
  onClose,
  onSave,
  onDelete,
  categories,
  selectedCount,
  programs,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
}: BulkEditImagesModalProps) {
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryChanged, setCategoryChanged] = useState(false)
  const [copyright, setCopyright] = useState('')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)
  const [activeChanged, setActiveChanged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const resetForm = useCallback(() => {
    setCategoryId(null)
    setCategoryChanged(false)
    setCopyright('')
    setNote('')
    setActive(true)
    setActiveChanged(false)
    setConfirmDelete(false)
    setDeleteError(null)
    setSaveError(null)
    setSaving(false)
  }, [])

  const handleEnter = useCallback(() => {
    resetForm()
  }, [resetForm])

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSave = async () => {
    setSaveError(null)
    const data: {
      category_id?: number | null
      copyright?: string
      note?: string
      active?: boolean
    } = {}
    if (categoryChanged) data.category_id = categoryId
    if (copyright.trim()) data.copyright = copyright.trim()
    if (note.trim()) data.note = note.trim()
    if (activeChanged) data.active = active
    setSaving(true)
    try {
      await onSave(data)
      resetForm()
    } catch {
      setSaving(false)
      setSaveError('Failed to save changes. Please try again.')
    }
  }

  const handleDelete = async () => {
    setDeleteError(null)
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
      setDeleteError('Failed to delete images. Please try again.')
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
            onEditCategory={onEditCategory}
            onToggleVisibility={onToggleVisibility}
            programs={programs}
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
      <Snackbar
        open={deleteError !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => { if (reason === 'clickaway') return; setDeleteError(null) }}
      >
        <Alert severity="error" variant="filled" onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={saveError !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => { if (reason === 'clickaway') return; setSaveError(null) }}
      >
        <Alert severity="error" variant="filled" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      </Snackbar>
    </Dialog>
  )
}
