import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { ImageItem } from '../types'

export const MIME_HRIV_IMAGE = 'application/x-hriv-image'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  onEditDetails?: (image: ImageItem) => void
  onToggleVisibility?: (imageId: number) => Promise<void>
  /** Enable HTML5 drag for this tile (editors only). */
  draggable?: boolean
}

export default function ImageTile({ image, onClick, onEditDetails, onToggleVisibility, draggable = false }: ImageTileProps) {
  const [dragging, setDragging] = useState(false)

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(MIME_HRIV_IMAGE, JSON.stringify({ id: image.id }))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }, [image.id])

  const handleDragEnd = useCallback(() => {
    setDragging(false)
  }, [])

  return (
    <Card
      elevation={2}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      sx={{ width: '100%', maxWidth: 300, position: 'relative', opacity: dragging ? 0.4 : 1, transition: 'opacity 0.15s' }}
    >
      {onToggleVisibility && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1,
            display: 'flex',
            gap: 0.5,
          }}
        >
          <Tooltip title={image.active ? 'Hide from students' : 'Show to students'}>
            <IconButton
              size="small"
              sx={{
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              onClick={(e) => {
                e.stopPropagation()
                onToggleVisibility(image.id)
              }}
              aria-label="Toggle visibility"
            >
              {image.active ? (
                <VisibilityIcon fontSize="small" />
              ) : (
                <DisabledVisibleIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <CardActionArea onClick={() => onClick(image)} sx={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'stretch' }}>
        <CardMedia
          component="img"
          height="160"
          image={image.thumb}
          alt={image.name}
          sx={{ objectFit: 'cover', objectPosition: 'center' }}
        />
        <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, opacity: !image.active ? 0.5 : 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="h6" noWrap>
              {image.name}
            </Typography>
            {!image.active && !onToggleVisibility && (
              <Tooltip title="Inactive">
                <DisabledVisibleIcon fontSize="small" color="disabled" />
              </Tooltip>
            )}
            {onEditDetails && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onEditDetails(image)
                }}
                aria-label="Edit image details"
                sx={{ flexShrink: 0, ml: 0.25 }}
              >
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
          {image.copyright && (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 1 }}>
              &copy; {image.copyright}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
