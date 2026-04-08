import { useState, useCallback, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import { uploadSourceImage } from '../api'
import CategoryPickerSelect from './CategoryPickerSelect'
import ImageMetadataFields from './ImageMetadataFields'
import type { ImageMetadataValues } from './ImageMetadataFields'
import type { Category, Program } from '../types'

/** Image file extensions accepted by the app (including TIFF). */
const ACCEPTED_IMAGE_TYPES = 'image/*,.tif,.tiff'

/** Recognised image extensions for drag-and-drop validation. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.svs',
])

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface UploadImageModalProps {
  open: boolean
  onClose: () => void
  onUploaded: () => void
  /** Called after file upload completes so the parent can track processing. */
  onProcessingStarted?: (sourceImageId: number, filename: string) => void
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
  onProcessingStarted,
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
  const [metadata, setMetadata] = useState<ImageMetadataValues>({
    copyright: '',
    note: '',
    programIds: [],
    active: true,
  })
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
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
    if (dropped && isImageFile(dropped)) {
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

  const handleReset = () => {
    setFile(null)
    setName('')
    setCategoryId(initialCategoryId ?? null)
    setMetadata({ copyright: '', note: '', programIds: [], active: true })
    setError(null)
    setUploading(false)
    setUploadProgress(null)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setUploadProgress(0)
    try {
      const result = await uploadSourceImage(
        file,
        name || undefined,
        categoryId ?? undefined,
        metadata.copyright || undefined,
        metadata.note || undefined,
        metadata.programIds.length > 0 ? metadata.programIds : undefined,
        metadata.active,
        (fraction) => setUploadProgress(fraction),
      )
      // Hand off processing tracking to the parent and close the modal
      onProcessingStarted?.(result.id, file.name)
      onUploaded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(null)
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
      <DialogTitle>Add Image</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
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
            <>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {file.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatBytes(file.size)}
              </Typography>
            </>
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
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Supports JPEG, PNG, TIFF, BMP, GIF, WebP, and SVS files.
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
        <ImageMetadataFields
          values={metadata}
          onChange={setMetadata}
          programs={programs}
          idPrefix="upload"
        />
        {uploading && uploadProgress !== null && (
          <Box sx={{ width: '100%' }}>
            <LinearProgress
              variant="determinate"
              value={Math.round(uploadProgress * 100)}
              sx={{ height: 8, borderRadius: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Uploading: {Math.round(uploadProgress * 100)}%
              {file ? ` (${formatBytes(Math.round(uploadProgress * file.size))} / ${formatBytes(file.size)})` : ''}
            </Typography>
          </Box>
        )}
        <Typography variant="caption" color="text.secondary">
          The image will be processed after upload to generate a zoomable view.
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
          {uploading ? 'Adding…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
