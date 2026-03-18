import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import FolderIcon from '@mui/icons-material/Folder'
import Box from '@mui/material/Box'
import type { Category } from '../types'

interface CategoryTileProps {
  category: Category
  onClick: (category: Category) => void
}

export default function CategoryTile({ category, onClick }: CategoryTileProps) {
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
          }}
        >
          <FolderIcon sx={{ fontSize: 64, opacity: 0.85 }} />
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
