import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import { uploadSourceImage } from '../api'

interface UploadImageModalProps {
  open: boolean
  onClose: () => void
  onUploaded: () => void
  categoryId?: number | null
}

export default function UploadImageModal({
  open,
  onClose,
  onUploaded,
  categoryId,
}: UploadImageModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [copyright, setCopyright] = useState('')
  const [origin, setOrigin] = useState('')
  const [program, setProgram] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type.startsWith('image/')) {
      setFile(dropped)
      if (!label) {
        setLabel(dropped.name.replace(/\.[^.]+$/, ''))
      }
    }
  }, [label])

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
        if (!label) {
          setLabel(selected.name.replace(/\.[^.]+$/, ''))
        }
      }
    },
    [label],
  )

  const handleReset = () => {
    setFile(null)
    setLabel('')
    setCopyright('')
    setOrigin('')
    setProgram('')
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
        label || undefined,
        categoryId ?? undefined,
        copyright || undefined,
        origin || undefined,
        program || undefined,
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
      <DialogContent>
        <Box
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
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
        <TextField
          label="Label"
          fullWidth
          variant="outlined"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Image label (defaults to filename)"
        />
        <TextField
          label="Copyright"
          fullWidth
          variant="outlined"
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="e.g. 2026 BCIT"
        />
        <TextField
          label="Origin"
          fullWidth
          variant="outlined"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Image origin or source"
        />
        <TextField
          label="Program"
          fullWidth
          variant="outlined"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Associated program"
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          The image will be processed in the background using VIPS to generate
          zoomable tiles for the viewer.
        </Typography>
        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
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
