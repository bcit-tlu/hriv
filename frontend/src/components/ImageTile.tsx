import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { ImageItem, Program } from '../types'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  programs: Program[]
  onEditDetails?: (image: ImageItem) => void
  onToggleVisibility?: (imageId: number, hide: boolean) => Promise<void>
}

export default function ImageTile({ image, onClick, programs, onEditDetails, onToggleVisibility }: ImageTileProps) {
  const programChips = image.programIds
    .map((pid) => programs.find((p) => p.id === pid))
    .filter((p): p is Program => p != null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300, position: 'relative' }}
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
                onToggleVisibility(image.id, image.active)
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
          {programChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {programChips.map((p) => (
                <Chip key={p.id} label={p.name} size="small" />
              ))}
            </Box>
          )}
          {image.copyright && (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 1 }}>
              &copy; {image.copyright}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {((image.width != null && image.height != null) || image.fileSize != null) && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {image.width != null && image.height != null
                  ? `${image.width} × ${image.height}`
                  : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {image.fileSize != null ? `${image.fileSize} MB` : ''}
              </Typography>
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
