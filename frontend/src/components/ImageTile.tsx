import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
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
            bgcolor: 'rgba(255,255,255,0.8)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.95)' },
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      )}
      <CardActionArea onClick={() => onClick(image)}>
        <CardMedia
          component="img"
          height="160"
          image={image.thumb}
          alt={image.name}
          sx={{ objectFit: 'cover' }}
        />
        <CardContent>
          <Typography variant="h6" noWrap>
            {image.name}
          </Typography>
          {programChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {programChips.map((p) => (
                <Chip key={p.id} label={p.name} size="small" />
              ))}
            </Box>
          )}
          {image.copyright && (
            <Typography variant="body2" color="text.secondary" noWrap>
              &copy; {image.copyright}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
