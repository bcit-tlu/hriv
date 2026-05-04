import { useState, useCallback, useEffect, useRef } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import { uploadSourceImage, bulkImportImages, fetchBulkImportJob } from '../api'
import type { ApiBulkImportJob } from '../api'
import CategoryPickerSelect from './CategoryPickerSelect'
import ImageMetadataFields from './ImageMetadataFields'
import type { ImageMetadataValues } from './ImageMetadataFields'
import type { Category, Program } from '../types'

/**
 * File-picker ``accept`` list. We list explicit MIME types instead of the
 * ``image/*`` glob so BMP (``image/bmp``) is excluded — the backend's
 * libvips build has no BMP loader. ``.tif`` / ``.tiff`` / ``.svs`` are
 * listed as extensions because browsers don't always attach a MIME type
 * to large pyramidal TIFFs or Aperio slides.  ZIP is accepted for bulk
 * import.
 */
const ACCEPTED_FILE_TYPES =
  'image/jpeg,image/png,image/tiff,image/gif,image/webp,.tif,.tiff,.svs,.zip'

/** Recognised image MIME types for drag-and-drop validation. Must stay
 * in lock-step with ``backend/app/routers/upload.py::_IMAGE_MIME_TYPES``. */
const IMAGE_MIME_TYPES = new Set<string>([
  'image/jpeg', 'image/png', 'image/tiff', 'image/gif', 'image/webp',
])

/** Recognised image extensions for drag-and-drop validation. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff', '.svs',
])

function isImageFile(file: File): boolean {
  if (IMAGE_MIME_TYPES.has(file.type)) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function isZipFile(file: File): boolean {
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return true
  return file.name.toLowerCase().endsWith('.zip')
}

function isAcceptedFile(file: File): boolean {
  return isImageFile(file) || isZipFile(file)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Whether the selected files should use the bulk-import workflow. */
function isBulkMode(files: File[]): boolean {
  return files.length > 1 || (files.length === 1 && isZipFile(files[0]))
}

interface UploadImageModalProps {
  open: boolean
  onClose: () => void
  onUploaded: () => void
  /** Called after file upload completes so the parent can track processing. */
  onProcessingStarted?: (sourceImageId: number, filename: string, fileSize: number, uploadId: number) => void
  /** Called when a file upload begins (before server response). */
  onUploadStarted?: (uploadId: number, filename: string, fileSize: number) => void
  /** Called with progress fraction (0-1) during upload. */
  onUploadProgress?: (uploadId: number, fraction: number) => void
  /** Called when a file upload fails. */
  onUploadFailed?: (uploadId: number, error: string) => void
  categoryId?: number | null
  categories: Category[]
  programs: Program[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<number | void>
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
  onUploadStarted,
  onUploadProgress,
  onUploadFailed,
}: UploadImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
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

  // Stable ref for onUploaded so polling/reset callbacks don't depend
  // on the (potentially unstable) inline closure from the parent.
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded

  // Bulk-import job state
  const [job, setJob] = useState<ApiBulkImportJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hadBulkJobRef = useRef(false)
  const bulkRefreshDoneRef = useRef(false)

  const bulk = isBulkMode(files)

  // Sync categoryId state when the dialog opens with a new prop value
  useEffect(() => {
    if (open) {
      setCategoryId(initialCategoryId ?? null)
    }
  }, [open, initialCategoryId])

  // Poll bulk-import job status until terminal
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    let cancelled = false
    pollRef.current = setInterval(async () => {
      try {
        const updated = await fetchBulkImportJob(job.id)
        if (cancelled) return
        setJob(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
          if (!bulkRefreshDoneRef.current) {
            bulkRefreshDoneRef.current = true
            onUploadedRef.current()
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 2000)
    return () => {
      cancelled = true
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [job])

  const handleReset = useCallback(() => {
    // If a bulk job was started but onUploaded hasn't fired yet
    // (e.g. user closed the dialog while import was still running),
    // notify the parent so it can refresh data.
    if (hadBulkJobRef.current && !bulkRefreshDoneRef.current) {
      onUploadedRef.current()
    }
    hadBulkJobRef.current = false
    bulkRefreshDoneRef.current = false
    setFiles([])
    setName('')
    setCategoryId(initialCategoryId ?? null)
    setMetadata({ copyright: '', note: '', programIds: [], active: true })
    setDragOver(false)
    setUploading(false)
    setUploadProgress(null)
    setError(null)
    setJob(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [initialCategoryId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
    if (dropped.length === 0) return

    setFiles((prev) => {
      const next = [...prev, ...dropped]
      if (next.length === 1 && isImageFile(next[0]) && !name) {
        setName(next[0].name.replace(/\.[^.]+$/, ''))
      }
      return next
    })
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
      const selected = Array.from(e.target.files ?? []).filter(isAcceptedFile)
      if (selected.length === 0) return

      setFiles((prev) => {
        const next = [...prev, ...selected]
        if (next.length === 1 && isImageFile(next[0]) && !name) {
          setName(next[0].name.replace(/\.[^.]+$/, ''))
        }
        return next
      })
      e.target.value = ''
    },
    [name],
  )

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      // If going from bulk to single-image mode, auto-set the name
      if (next.length === 1 && isImageFile(next[0])) {
        setName(next[0].name.replace(/\.[^.]+$/, ''))
      }
      return next
    })
  }, [])

  const uploadIdRef = useRef<number | null>(null)

  const handleUpload = async () => {
    if (files.length === 0) return

    if (bulk) {
      // Bulk import workflow
      if (categoryId == null) {
        setError('Please select a category')
        return
      }
      setUploading(true)
      setError(null)
      try {
        const result = await bulkImportImages(
          files,
          categoryId,
          metadata.copyright || undefined,
          metadata.note || undefined,
          metadata.programIds.length > 0 ? metadata.programIds : undefined,
          metadata.active,
        )
        hadBulkJobRef.current = true
        setJob(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    } else {
      // Single image upload workflow
      const file = files[0]
      setUploading(true)
      setError(null)
      setUploadProgress(0)
      const uploadId = Date.now()
      uploadIdRef.current = uploadId
      onUploadStarted?.(uploadId, file.name, file.size)
      try {
        const result = await uploadSourceImage(
          file,
          name || undefined,
          categoryId ?? undefined,
          metadata.copyright || undefined,
          metadata.note || undefined,
          metadata.programIds.length > 0 ? metadata.programIds : undefined,
          metadata.active,
          (fraction) => {
            setUploadProgress(fraction)
            onUploadProgress?.(uploadId, fraction)
          },
        )
        onProcessingStarted?.(result.id, file.name, file.size, uploadId)
        onUploaded()
        onClose()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setError(msg)
        onUploadFailed?.(uploadId, msg)
      } finally {
        setUploading(false)
        setUploadProgress(null)
        uploadIdRef.current = null
      }
    }
  }

  const isTerminal = job?.status === 'completed' || job?.status === 'failed'
  const progressPercent =
    job && job.total_count > 0
      ? Math.round(((job.completed_count + job.failed_count) / job.total_count) * 100)
      : 0

  const singleFile = files.length === 1 && !bulk ? files[0] : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: handleReset }}
    >
      <DialogTitle>Add Images</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        {!job ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
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
              {singleFile ? (
                <>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {singleFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(singleFile.size)}
                  </Typography>
                </>
              ) : files.length === 0 ? (
                <>
                  <Typography variant="body1" color="text.secondary">
                    Drag and drop images or zip files here
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
                    Supports JPEG, PNG, TIFF, GIF, WebP, SVS, and ZIP files.
                  </Typography>
                </>
              ) : (
                <Typography variant="body1" color="text.secondary">
                  {files.length} file{files.length !== 1 ? 's' : ''} selected
                </Typography>
              )}
            </Box>

            {/* File chips for bulk mode */}
            {bulk && files.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {files.map((f, i) => (
                  <Chip
                    key={`${f.name}-${i}`}
                    label={f.name}
                    size="small"
                    onDelete={() => handleRemoveFile(i)}
                    color={isZipFile(f) ? 'secondary' : 'default'}
                  />
                ))}
              </Box>
            )}

            {/* Name field only in single-image mode */}
            {!bulk && (
              <TextField
                label="Name"
                fullWidth
                variant="outlined"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Image name (defaults to filename)"
              />
            )}

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
            {uploading && uploadProgress !== null && !bulk && (
              <Box sx={{ width: '100%' }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.round(uploadProgress * 100)}
                  sx={{ height: 8, borderRadius: 1 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  Uploading: {Math.round(uploadProgress * 100)}%
                  {singleFile ? ` (${formatBytes(Math.round(uploadProgress * singleFile.size))} / ${formatBytes(singleFile.size)})` : ''}
                </Typography>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Images are processed after upload to generate a zoomable view, with the name set to their filename.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
              ---
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
              Zip files will be extracted and all image files inside will be imported. You can bulk-edit metadata later from the <strong>Images</strong> page.
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </>
        ) : (
          /* Bulk-import progress view */
          <Box sx={{ mt: 1 }}>
            <Typography variant="body1" sx={{ mb: 1 }}>
              Job #{job.id} &mdash;{' '}
              <Typography
                component="span"
                variant="body1"
                sx={{
                  fontWeight: 600,
                  color:
                    job.status === 'completed'
                      ? 'success.main'
                      : job.status === 'failed'
                        ? 'error.main'
                        : 'info.main',
                }}
              >
                {job.status}
              </Typography>
            </Typography>

            <LinearProgress
              variant="determinate"
              value={progressPercent}
              sx={{ height: 8, borderRadius: 1, mb: 1 }}
            />

            <Typography variant="body2" color="text.secondary">
              {job.completed_count} of {job.total_count} completed
              {job.failed_count > 0 && `, ${job.failed_count} failed`}
            </Typography>

            {!isTerminal && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Processing images in the background...
              </Typography>
            )}

            {job.errors && job.errors.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Errors:
                </Typography>
                {job.errors.map((err, i) => (
                  <Typography key={i} variant="caption" display="block">
                    {err.filename}: {err.error}
                  </Typography>
                ))}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {!job ? (
          <>
            <Button onClick={onClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={files.length === 0 || uploading}
              onClick={handleUpload}
              startIcon={uploading ? <CircularProgress size={16} /> : undefined}
            >
              {uploading
                ? bulk ? 'Uploading...' : 'Adding\u2026'
                : bulk
                  ? `Import ${files.length} file${files.length !== 1 ? 's' : ''}`
                  : 'Add'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose} variant={isTerminal ? 'contained' : 'outlined'}>
            {isTerminal ? 'Done' : 'Close'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
