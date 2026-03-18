import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import type { ImageItem } from '../types'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
}

export default function ImageTile({ image, onClick }: ImageTileProps) {
  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300 }}
    >
      <CardActionArea onClick={() => onClick(image)}>
        <CardMedia
          component="img"
          height="160"
          image={image.thumb}
          alt={image.label}
          sx={{ objectFit: 'cover' }}
        />
        <CardContent>
          <Typography variant="subtitle1" noWrap>
            {image.label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click to view
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
