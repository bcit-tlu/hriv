import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { ApiImage } from '../api'
import type { Category, Program } from '../types'
import CategoryPickerSelect from './CategoryPickerSelect'

export interface ImageFormData {
  name?: string
  category_id?: number | null
  copyright?: string
  note?: string
  program_ids?: number[]
  active?: boolean
}

interface EditImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ImageFormData) => void
  image: ApiImage | null
  categories: Category[]
  programs: Program[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
}

function EditImageForm({
  onClose,
  onSave,
  image,
  categories,
  programs,
  onAddCategory,
}: Omit<EditImageModalProps, 'open'>) {
  const [name, setName] = useState(image?.name ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(image?.category_id ?? null)
  const [copyright, setCopyright] = useState(image?.copyright ?? '')
  const [note, setNote] = useState(image?.note ?? '')
  const [programIds, setProgramIds] = useState<number[]>(image?.program_ids ?? [])
  const [active, setActive] = useState(image?.active ?? true)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type.startsWith('image/')) {
      setFile(dropped)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) {
        setFile(selected)
      }
    },
    [],
  )

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const value = event.target.value
    setProgramIds(typeof value === 'string' ? [] : value)
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    onSave({
      name: trimmedName,
      category_id: categoryId,
      copyright: copyright.trim() || undefined,
      note: note.trim() || undefined,
      program_ids: programIds,
      active,
    })
  }

  return (
    <>
      <DialogTitle>Edit Details</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        {/* Replace image drop zone */}
        <Box
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          sx={{
            mt: 1,
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'grey.400',
            borderRadius: 2,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            bgcolor: dragOver ? 'action.hover' : 'grey.50',
            transition: 'all 0.2s',
            cursor: 'pointer',
          }}
        >
          <CloudUploadIcon
            sx={{ fontSize: 36, color: 'grey.500', mb: 0.5 }}
          />
          {file ? (
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {file.name}
            </Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                Drag and drop to replace image
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                or{' '}
                <Link component="label" sx={{ cursor: 'pointer' }}>
                  browse to upload
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleFileSelect}
                  />
                </Link>
              </Typography>
            </>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          Image replacement processing will be added in a future update.
        </Typography>

        <TextField
          autoFocus
          label="Name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Box>
          <CategoryPickerSelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
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
          <InputLabel id="program-select-label">Program</InputLabel>
          <Select
            labelId="program-select-label"
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
              onChange={(e) => setActive(e.target.checked)}
            />
          }
          label="Active (visible to students)"
        />
        {image && (
          <Box sx={{ display: 'flex', gap: 4, mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Created: {new Date(image.created_at).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Modified: {new Date(image.updated_at).toLocaleString()}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!name.trim()}
        >
          Save
        </Button>
      </DialogActions>
    </>
  )
}

export default function EditImageModal({
  open,
  onClose,
  onSave,
  image,
  categories,
  programs,
  onAddCategory,
}: EditImageModalProps) {
  const formKey = image ? `edit-${image.id}` : 'closed'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      {open && (
        <EditImageForm
          key={formKey}
          onClose={onClose}
          onSave={onSave}
          image={image}
          categories={categories}
          programs={programs}
          onAddCategory={onAddCategory}
        />
      )}
    </Dialog>
  )
}
