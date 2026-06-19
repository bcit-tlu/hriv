import { useCallback, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'

interface FileDropZoneProps {
  /** Whether the browser-level drag event is active (files are being dragged over the page). */
  isDragActive: boolean
  /** Called when files are dropped onto this zone. */
  onDrop: (files: File[]) => void
}

/**
 * A visually prominent drop target rendered at the end of the card grid.
 * Only visible when the user is actively dragging files into the viewport.
 */
export default function FileDropZone({ isDragActive, onDrop }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current += 1
    if (dragCounter.current === 1) setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setDragOver(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onDrop(files)
    },
    [onDrop],
  )

  if (!isDragActive) return null

  return (
    <Box
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      sx={{
        width: '100%',
        maxWidth: 300,
        minHeight: 220,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        borderRadius: 1,
        border: '3px dashed',
        borderColor: dragOver ? 'primary.dark' : 'primary.main',
        bgcolor: (theme) =>
          dragOver
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.primary.main, 0.06),
        transition: 'border-color 0.2s, background-color 0.2s, transform 0.15s',
        transform: dragOver ? 'scale(1.02)' : 'scale(1)',
        cursor: 'copy',
      }}
      role="region"
      aria-label="Drop files here to upload images"
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: dragOver ? 'primary.main' : 'primary.light',
          color: 'primary.contrastText',
          transition: 'background-color 0.2s',
        }}
      >
        <AddIcon sx={{ fontSize: 36 }} />
      </Box>
      <Typography
        variant="subtitle1"
        color="primary.main"
        sx={{ fontWeight: 600, userSelect: 'none' }}
      >
        Add images
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ userSelect: 'none' }}>
        Drop files here
      </Typography>
    </Box>
  )
}
