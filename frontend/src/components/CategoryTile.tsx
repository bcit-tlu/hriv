import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import FolderIcon from '@mui/icons-material/Folder'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import Box from '@mui/material/Box'
import type { Category } from '../types'

interface CategoryTileProps {
  category: Category
  onClick: (category: Category) => void
  onMove?: (category: Category) => void
}

export default function CategoryTile({ category, onClick, onMove }: CategoryTileProps) {
  const itemCount =
    category.children.length + category.images.length

  return (
    <Card
      elevation={2}
      sx={{ width: '100%', maxWidth: 300 }}
    >
      <CardActionArea onClick={() => onClick(category)}>
        <Box
          sx={{
            height: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'primary.main',
            color: 'white',
            position: 'relative',
          }}
        >
          <FolderIcon sx={{ fontSize: 64, opacity: 0.85 }} />
          {onMove && (
            <IconButton
              size="small"
              sx={{
                position: 'absolute',
                top: 4,
                right: 4,
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onMove(category)
              }}
              aria-label="Move category"
            >
              <DriveFileMoveIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        <CardContent>
          <Typography variant="subtitle1" noWrap>
            {category.label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
