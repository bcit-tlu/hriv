import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import { alpha } from '@mui/material/styles'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import type { ImageItem } from '../types'
import { useColorMode } from '../useColorMode'
import { getVisibilityColors } from '../theme'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  onEditDetails?: (image: ImageItem) => void
  onToggleVisibility?: (imageId: number) => Promise<void>
}

export default function ImageTile({ image, onClick, onEditDetails, onToggleVisibility }: ImageTileProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300, position: 'relative' }}
    >
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
        {onToggleVisibility && (
          <Tooltip title={image.active ? 'Visibility: Hide from students' : 'Visibility: Show to students'}>
            <IconButton
              size="small"
              sx={{
                color: image.active ? visColors.active : visColors.inactive,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
                '&:hover': { bgcolor: (theme) => alpha(theme.palette.background.paper, 0.95) },
              }}
              onClick={(e) => {
                e.stopPropagation()
                onToggleVisibility(image.id)
              }}
              aria-label="Toggle visibility"
            >
              {image.active ? (
                <VisibilityOutlined fontSize="small" />
              ) : (
                <VisibilityOffOutlined fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <CardActionArea onClick={() => onClick(image)} sx={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'stretch', filter: !image.active ? 'grayscale(100%)' : 'none' }}>
        <CardMedia
          component="img"
          height="160"
          image={image.thumb}
          alt={image.name}
          sx={{ objectFit: 'cover', objectPosition: 'center' }}
        />
        <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="h6" noWrap sx={!image.active ? { color: visColors.inactive } : undefined}>
              {image.name}
            </Typography>
            {!image.active && !onToggleVisibility && (
              <Tooltip title="Visibility: Inactive">
                <VisibilityOffOutlined fontSize="small" sx={{ color: visColors.inactive }} />
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
