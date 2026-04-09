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
import MoreVertIcon from '@mui/icons-material/MoreVert'
import type { ImageItem, Program } from '../types'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  programs: Program[]
  onEditDetails?: (image: ImageItem) => void
}

export default function ImageTile({ image, onClick, programs, onEditDetails }: ImageTileProps) {
  const programChips = image.programIds
    .map((pid) => programs.find((p) => p.id === pid))
    .filter((p): p is Program => p != null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300, position: 'relative' }}
    >
      {onEditDetails && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onEditDetails(image)
          }}
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1,
            color: 'white',
            bgcolor: 'rgba(0,0,0,0.25)',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      )}
      <CardActionArea onClick={() => onClick(image)} sx={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'stretch' }}>
        <CardMedia
          component="img"
          height="160"
          image={image.thumb}
          alt={image.name}
          sx={{ objectFit: 'cover' }}
        />
        <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="h6" noWrap sx={{ opacity: !image.active ? 0.5 : 1 }}>
              {image.name}
            </Typography>
            {!image.active && (
              <Tooltip title="Inactive">
                <DisabledVisibleIcon fontSize="small" color="disabled" />
              </Tooltip>
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
