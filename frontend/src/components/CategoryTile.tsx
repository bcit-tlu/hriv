import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import FolderIcon from '@mui/icons-material/Folder'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import type { Category, ImageItem } from '../types'
import CardImagePickerModal from './CardImagePickerModal'

function findImageInCategory(cat: Category, imageId: number): ImageItem | null {
  for (const img of cat.images) {
    if (img.id === imageId) return img
  }
  for (const child of cat.children) {
    const found = findImageInCategory(child, imageId)
    if (found) return found
  }
  return null
}

interface CategoryTileProps {
  category: Category
  onClick: (category: Category) => void
  onMove?: (category: Category) => void
  onSetCardImage?: (categoryId: number, imageId: number | null) => void
}

export default function CategoryTile({ category, onClick, onMove, onSetCardImage }: CategoryTileProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const subCategoryCount = category.children.length
  const imageCount = category.images.length
  const programCount = new Set(category.images.flatMap((img) => img.programIds)).size

  const detailParts: string[] = []
  if (subCategoryCount > 0) {
    detailParts.push(`${subCategoryCount} sub-${subCategoryCount === 1 ? 'category' : 'categories'}`)
  }
  if (imageCount > 0) {
    detailParts.push(`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`)
  }
  if (programCount > 0) {
    detailParts.push(`${programCount} ${programCount === 1 ? 'program' : 'programs'}`)
  }
  const detailText = detailParts.length > 0 ? detailParts.join(' \u00b7 ') : 'Empty'

  const cardImage = category.cardImageId
    ? findImageInCategory(category, category.cardImageId)
    : null

  return (
    <>
      <Card
        elevation={2}
        sx={{ width: '100%', maxWidth: 300, position: 'relative' }}
      >
        <CardActionArea onClick={() => onClick(category)}>
          {cardImage ? (
            <CardMedia
              component="img"
              height="140"
              image={cardImage.thumb}
              alt={category.label}
              sx={{ objectFit: 'cover' }}
            />
          ) : (
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
          )}
          <CardContent>
            <Typography variant="h6" noWrap>
              {category.label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {detailText}
            </Typography>
          </CardContent>
        </CardActionArea>
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            display: 'flex',
            gap: 0.5,
          }}
        >
          {onSetCardImage && (
            <IconButton
              size="small"
              sx={{
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setPickerOpen(true)
              }}
              aria-label="Set card image"
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
          {onMove && (
            <IconButton
              size="small"
              sx={{
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
      </Card>

      {onSetCardImage && pickerOpen && (
        <CardImagePickerModal
          open
          onClose={() => setPickerOpen(false)}
          onSave={(imageId) => {
            onSetCardImage(category.id, imageId)
            setPickerOpen(false)
          }}
          category={category}
          currentImageId={category.cardImageId ?? null}
        />
      )}
    </>
  )
}
