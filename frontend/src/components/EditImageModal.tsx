import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import type { ApiImage } from '../api'
import type { Category } from '../types'
import CategoryPickerSelect from './CategoryPickerSelect'

export interface ImageFormData {
  label?: string
  category_id?: number | null
  copyright?: string
  origin?: string
  program?: string
  active?: boolean
}

interface EditImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ImageFormData) => void
  image: ApiImage | null
  categories: Category[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
}

function EditImageForm({
  onClose,
  onSave,
  image,
  categories,
  onAddCategory,
}: Omit<EditImageModalProps, 'open'>) {
  const [label, setLabel] = useState(image?.label ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(image?.category_id ?? null)
  const [copyright, setCopyright] = useState(image?.copyright ?? '')
  const [origin, setOrigin] = useState(image?.origin ?? '')
  const [program, setProgram] = useState(image?.program ?? '')
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

  const handleSave = () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    onSave({
      label: trimmedLabel,
      category_id: categoryId,
      copyright: copyright.trim() || undefined,
      origin: origin.trim() || undefined,
      program: program.trim() || undefined,
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
          label="Label"
          fullWidth
          variant="outlined"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
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
              onChange={(e) => setActive(e.target.checked)}
            />
          }
          label="Active (visible to students)"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!label.trim()}
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
          onAddCategory={onAddCategory}
        />
      )}
    </Dialog>
  )
}
