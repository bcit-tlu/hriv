import { useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'

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

interface ReplaceImageModalProps {
  open: boolean
  onClose: () => void
  imageLabel: string
}

export default function ReplaceImageModal({
  open,
  onClose,
  imageLabel,
}: ReplaceImageModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && isImageFile(dropped)) {
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

  const handleReset = () => {
    setFile(null)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: handleReset }}
    >
      <DialogTitle>Replace Image — {imageLabel}</DialogTitle>
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
                    accept={ACCEPTED_IMAGE_TYPES}
                    hidden
                    onChange={handleFileSelect}
                  />
                </Link>
              </Typography>
            </>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          Image processing functionality will be added in a future update.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!file}>
          Upload
        </Button>
      </DialogActions>
    </Dialog>
  )
}
