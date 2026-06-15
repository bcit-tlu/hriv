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
import { uploadSourceImage, bulkImportImages, userMessage } from '../api'
import type { ApiBulkImportJob } from '../api'
import { isImageFile, isZipFile, isAcceptedFile } from '../fileUtils'
import CategoryPickerSelect from './CategoryPickerSelect'
import ImageMetadataFields from './ImageMetadataFields'
import type { ImageMetadataValues } from './ImageMetadataFields'
import type { Category, Group, Program } from '../types'

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
  /** Called after a bulk import upload completes so the parent can track processing. */
  onBulkImportStarted?: (
    job: ApiBulkImportJob,
    filename: string,
    fileSize: number,
    uploadId: number,
  ) => void
  /** Called when a file upload fails. */
  onUploadFailed?: (uploadId: number, error: string) => void
  /** Pre-populate the file list (e.g. from a drag-and-drop onto the grid). */
  initialFiles?: File[]
  categoryId?: number | null
  categories: Category[]
  programs?: Program[]
  groups?: Group[]
  onAddCategory?: (label: string, parentId: number | null, programIds?: number[], groupIds?: number[]) => Promise<number | void>
  onEditCategory?: (categoryId: number, newLabel: string, programIds?: number[], groupIds?: number[]) => Promise<void>
  onToggleVisibility?: (categoryId: number) => Promise<void>
}

export default function UploadImageModal({
  open,
  onClose,
  onUploaded,
  onProcessingStarted,
  initialFiles,
  categoryId: initialCategoryId,
  categories,
  programs,
  groups,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  onUploadStarted,
  onUploadProgress,
  onBulkImportStarted,
  onUploadFailed,
}: UploadImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(initialCategoryId ?? null)
  const [metadata, setMetadata] = useState<ImageMetadataValues>({
    copyright: '',
    note: '',
    active: true,
  })
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bulk = isBulkMode(files)

  // Sync categoryId state when the dialog opens with a new prop value
  useEffect(() => {
    if (open) {
      setCategoryId(initialCategoryId ?? null) // eslint-disable-line react-hooks/set-state-in-effect -- sync prop→state on dialog open
    }
  }, [open, initialCategoryId])

  // Pre-populate files from external drag-and-drop
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      const accepted = initialFiles.filter(isAcceptedFile)
      if (accepted.length === 0) return
      setFiles(accepted) // eslint-disable-line react-hooks/set-state-in-effect -- sync prop→state on dialog open
      if (accepted.length === 1 && isImageFile(accepted[0])) {
        setName(accepted[0].name.replace(/\.[^.]+$/, ''))
      }
    }
  }, [open, initialFiles])

  const handleReset = useCallback(() => {
    setFiles([])
    setName('')
    setCategoryId(initialCategoryId ?? null)
    setMetadata({ copyright: '', note: '', active: true })
    setDragOver(false)
    setUploading(false)
    setUploadProgress(null)
    setError(null)
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
  const abortRef = useRef<AbortController | null>(null)

  const handleUpload = async () => {
    if (files.length === 0) return

    if (bulk) {
      // Bulk import workflow — category is optional (images go to root if unset)
      setUploading(true)
      setError(null)
      setUploadProgress(0)
      const uploadId = Date.now()
      uploadIdRef.current = uploadId
      const abort = new AbortController()
      abortRef.current = abort
      const uploadFilename =
        files.length === 1 ? files[0].name : `${files.length} files`
      const uploadFileSize = files.reduce((total, file) => total + file.size, 0)
      onUploadStarted?.(uploadId, uploadFilename, uploadFileSize)
      try {
        const result = await bulkImportImages(
          files,
          categoryId,
          metadata.copyright || undefined,
          metadata.note || undefined,
          metadata.active,
          (fraction: number) => {
            setUploadProgress(fraction)
            onUploadProgress?.(uploadId, fraction)
          },
          abort.signal,
        )
        onBulkImportStarted?.(result, uploadFilename, uploadFileSize, uploadId)
        onClose()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          onUploadFailed?.(uploadId, 'Upload cancelled')
          onClose()
        } else {
          const msg = userMessage(err, 'Upload failed')
          setError(msg)
          onUploadFailed?.(uploadId, msg)
        }
      } finally {
        setUploading(false)
        setUploadProgress(null)
        uploadIdRef.current = null
        abortRef.current = null
      }
    } else {
      // Single image upload workflow
      const file = files[0]
      setUploading(true)
      setError(null)
      setUploadProgress(0)
      const uploadId = Date.now()
      uploadIdRef.current = uploadId
      const abort = new AbortController()
      abortRef.current = abort
      onUploadStarted?.(uploadId, file.name, file.size)
      try {
        const result = await uploadSourceImage(
          file,
          name || undefined,
          categoryId ?? undefined,
          metadata.copyright || undefined,
          metadata.note || undefined,
          metadata.active,
          (fraction: number) => {
            setUploadProgress(fraction)
            onUploadProgress?.(uploadId, fraction)
          },
          abort.signal,
        )
        onProcessingStarted?.(result.id, file.name, file.size, uploadId)
        onUploaded()
        onClose()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          onUploadFailed?.(uploadId, 'Upload cancelled')
          onClose()
        } else {
          const msg = userMessage(err, 'Upload failed')
          setError(msg)
          onUploadFailed?.(uploadId, msg)
        }
      } finally {
        setUploading(false)
        setUploadProgress(null)
        uploadIdRef.current = null
        abortRef.current = null
      }
    }
  }

  const singleFile = files.length === 1 && !bulk ? files[0] : null
  const selectedBytes =
    singleFile?.size ?? files.reduce((total, file) => total + file.size, 0)

  return (
    <Dialog
      open={open}
      onClose={uploading ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: handleReset }}
    >
      <DialogTitle>Add Images</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
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
                programs={programs}
                groups={groups}
              />
            </Box>
            <ImageMetadataFields
              values={metadata}
              onChange={setMetadata}
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
                  {` (${formatBytes(Math.round(uploadProgress * selectedBytes))} / ${formatBytes(selectedBytes)})`}
                </Typography>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Uploaded images are processed into zoomable views and named from their filenames. ZIP uploads are automatically extracted and imported, and metadata can be bulk-edited later from the <strong>Images</strong> page.
            </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            if (uploading && abortRef.current) {
              abortRef.current.abort()
            } else {
              onClose()
            }
          }}
        >
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
      </DialogActions>
    </Dialog>
  )
}
