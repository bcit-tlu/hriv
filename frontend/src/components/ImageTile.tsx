import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import type { ImageItem } from '../types'
import { useColorMode } from '../useColorMode'
import { getVisibilityColors } from '../theme'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  onEditDetails?: (image: ImageItem) => void
}

export default function ImageTile({ image, onClick, onEditDetails }: ImageTileProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300, position: 'relative' }}
    >
      
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
            {!image.active && (
              <Tooltip title="Visibility: Inactive">
                <span role="img" aria-label="Visibility: Inactive" style={{ display: 'inline-flex' }}>
                  <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                </span>
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
