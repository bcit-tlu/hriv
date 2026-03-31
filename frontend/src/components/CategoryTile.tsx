import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import FolderIcon from '@mui/icons-material/Folder'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import type { Category, ImageItem, Program } from '../types'
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

/** Collect all unique program IDs from a category and all its descendants. */
function collectProgramIds(cat: Category): Set<number> {
  const ids = new Set<number>()
  for (const img of cat.images) {
    for (const pid of img.programIds) ids.add(pid)
  }
  for (const child of cat.children) {
    for (const pid of collectProgramIds(child)) ids.add(pid)
  }
  return ids
}

interface CategoryTileProps {
  category: Category
  onClick: (category: Category) => void
  onMove?: (category: Category) => void
  onSetCardImage?: (categoryId: number, imageId: number | null) => void
  programs: Program[]
}

export default function CategoryTile({ category, onClick, onMove, onSetCardImage, programs }: CategoryTileProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const subCategoryCount = category.children.length
  const imageCount = category.images.length
  const programIds = collectProgramIds(category)

  const detailParts: string[] = []
  if (subCategoryCount > 0) {
    detailParts.push(`${subCategoryCount} sub-${subCategoryCount === 1 ? 'category' : 'categories'}`)
  }
  if (imageCount > 0) {
    detailParts.push(`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`)
  }
  const detailText = detailParts.length > 0 ? detailParts.join(' \u00b7 ') : 'Empty'

  const programChips = Array.from(programIds)
    .map((pid) => programs.find((p) => p.id === pid))
    .filter((p): p is Program => p != null)
    .sort((a, b) => a.name.localeCompare(b.name))

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
            {programChips.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {programChips.map((p) => (
                  <Chip key={p.id} label={p.name} size="small" />
                ))}
              </Box>
            )}
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
