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
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import CategoryPickerSelect from './CategoryPickerSelect'
import { bulkImportImages, fetchBulkImportJob } from '../api'
import type { ApiBulkImportJob } from '../api'
import type { Category } from '../types'

interface BulkImportModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
}

export default function BulkImportModal({
  open,
  onClose,
  categories,
  onAddCategory,
}: BulkImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<ApiBulkImportJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll job status until terminal
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await fetchBulkImportJob(job.id)
        setJob(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 2000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [job])

  const handleReset = useCallback(() => {
    setFiles([])
    setCategoryId(null)
    setDragOver(false)
    setUploading(false)
    setError(null)
    setJob(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) {
      setFiles((prev) => [...prev, ...dropped])
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
      const selected = Array.from(e.target.files ?? [])
      if (selected.length > 0) {
        setFiles((prev) => [...prev, ...selected])
      }
      e.target.value = ''
    },
    [],
  )

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleUpload = async () => {
    if (files.length === 0) return
    if (categoryId == null) {
      setError('Please select a category')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const result = await bulkImportImages(files, categoryId)
      setJob(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const progressPercent =
    job && job.total_count > 0
      ? Math.round(((job.completed_count + job.failed_count) / job.total_count) * 100)
      : 0

  const isTerminal = job?.status === 'completed' || job?.status === 'failed'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: handleReset }}
    >
      <DialogTitle>Bulk Import Images</DialogTitle>
      <DialogContent>
        {!job ? (
          <>
            {/* Drop zone */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.zip"
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
                minHeight: 140,
                bgcolor: dragOver ? 'action.hover' : 'grey.50',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
            >
              <CloudUploadIcon sx={{ fontSize: 48, color: 'grey.500', mb: 1 }} />
              <Typography variant="body1" color="text.secondary">
                Drag and drop images or zip files here
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                or{' '}
                <Typography
                  component="span"
                  variant="body2"
                  color="primary"
                  sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                >
                  browse to select files
                </Typography>
              </Typography>
            </Box>

            {/* File list */}
            {files.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {files.map((file, i) => (
                  <Chip
                    key={`${file.name}-${i}`}
                    label={file.name}
                    size="small"
                    onDelete={() => handleRemoveFile(i)}
                    color={file.name.endsWith('.zip') ? 'secondary' : 'default'}
                  />
                ))}
              </Box>
            )}

            {/* Category picker */}
            <Box sx={{ mt: 2 }}>
              <CategoryPickerSelect
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                label="Target Category"
                includeRoot={false}
                onAddCategory={onAddCategory}
              />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              All images will be imported with sane defaults: active, name set to
              filename, copyright set to &quot;Public Domain&quot;. You can bulk-edit
              metadata later from the Images page.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Zip files will be extracted and all image files inside will be imported.
            </Typography>
          </>
        ) : (
          /* Progress view */
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

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
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
              disabled={files.length === 0 || categoryId == null || uploading}
              onClick={handleUpload}
              startIcon={uploading ? <CircularProgress size={16} /> : undefined}
            >
              {uploading ? 'Uploading...' : `Import ${files.length} file${files.length !== 1 ? 's' : ''}`}
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
