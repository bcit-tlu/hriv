import { useState, useCallback, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import type { SelectChangeEvent } from '@mui/material/Select'
import { uploadSourceImage } from '../api'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category, Program } from '../types'

interface UploadImageModalProps {
  open: boolean
  onClose: () => void
  onUploaded: () => void
  categoryId?: number | null
  categories: Category[]
  programs: Program[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
}

export default function UploadImageModal({
  open,
  onClose,
  onUploaded,
  categoryId: initialCategoryId,
  categories,
  programs,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
}: UploadImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(initialCategoryId ?? null)
  const [copyright, setCopyright] = useState('')
  const [note, setNote] = useState('')
  const [programIds, setProgramIds] = useState<number[]>([])
  const [active, setActive] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync categoryId state when the dialog opens with a new prop value
  useEffect(() => {
    if (open) {
      setCategoryId(initialCategoryId ?? null)
    }
  }, [open, initialCategoryId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type.startsWith('image/')) {
      setFile(dropped)
      if (!name) {
        setName(dropped.name.replace(/\.[^.]+$/, ''))
      }
    }
  }, [name])

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
        if (!name) {
          setName(selected.name.replace(/\.[^.]+$/, ''))
        }
      }
    },
    [name],
  )

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const value = event.target.value
    setProgramIds(typeof value === 'string' ? [] : value)
  }

  const handleReset = () => {
    setFile(null)
    setName('')
    setCategoryId(initialCategoryId ?? null)
    setCopyright('')
    setNote('')
    setProgramIds([])
    setActive(true)
    setError(null)
    setUploading(false)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await uploadSourceImage(
        file,
        name || undefined,
        categoryId ?? undefined,
        copyright || undefined,
        note || undefined,
        programIds.length > 0 ? programIds : undefined,
        active,
      )
      onUploaded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: handleReset }}
    >
      <DialogTitle>Upload Image</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFileSelect}
        />
        <Box
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            mt: 1,
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'grey.400',
            borderRadius: 2,
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 180,
            bgcolor: dragOver ? 'action.hover' : 'grey.50',
            transition: 'all 0.2s',
            cursor: 'pointer',
          }}
        >
          <CloudUploadIcon
            sx={{ fontSize: 48, color: 'grey.500', mb: 1 }}
          />
          {file ? (
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {file.name}
            </Typography>
          ) : (
            <>
              <Typography variant="body1" color="text.secondary">
                Drag and drop an image here
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                or{' '}
                <Typography
                  component="span"
                  variant="body2"
                  color="primary"
                  sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                >
                  browse to upload
                </Typography>
              </Typography>
            </>
          )}
        </Box>
        <TextField
          label="Name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Image name (defaults to filename)"
        />
        <Box>
          <CategoryPickerSelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            onAddCategory={onAddCategory}
            onEditCategory={onEditCategory}
            onToggleVisibility={onToggleVisibility}
          />
        </Box>
        <TextField
          label="Copyright"
          fullWidth
          variant="outlined"
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
          placeholder="e.g. 2026 BCIT"
        />
        <TextField
          label="Note"
          fullWidth
          variant="outlined"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Image note"
        />
        <FormControl fullWidth>
          <InputLabel id="upload-program-select-label">Program</InputLabel>
          <Select
            labelId="upload-program-select-label"
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
        <Typography variant="caption" color="text.secondary">
          The image will be processed in the background using VIPS to generate
          zoomable tiles for the viewer.
        </Typography>
        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={uploading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!file || uploading}
          onClick={handleUpload}
          startIcon={uploading ? <CircularProgress size={16} /> : undefined}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
