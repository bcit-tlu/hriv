import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import EditIcon from '@mui/icons-material/Edit'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import ImageIcon from '@mui/icons-material/Image'
import VisibilityIcon from '@mui/icons-material/Visibility'
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

/** Count all descendant subcategories recursively. */
function countAllSubcategories(cat: Category): number {
  let count = cat.children.length
  for (const child of cat.children) {
    count += countAllSubcategories(child)
  }
  return count
}

/** Count all images in a category and all its descendants. */
function countAllImages(cat: Category): number {
  let count = cat.images.length
  for (const child of cat.children) {
    count += countAllImages(child)
  }
  return count
}


interface CategoryTileProps {
  category: Category
  onClick: (category: Category) => void
  onMove?: (category: Category) => void
  onSetCardImage?: (categoryId: number, imageId: number | null) => void
  onToggleVisibility?: (categoryId: number) => Promise<void>
  onEditName?: (category: Category) => void
  programs: Program[]
  /** Program IDs inherited from an ancestor category (shown at reduced opacity). */
  ancestorProgramIds?: number[]
}

export default function CategoryTile({ category, onClick, onMove, onSetCardImage, onToggleVisibility, onEditName, programs, ancestorProgramIds = [] }: CategoryTileProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const subCategoryCount = useMemo(() => countAllSubcategories(category), [category])
  const imageCount = useMemo(() => countAllImages(category), [category])

  const detailParts: string[] = []
  if (subCategoryCount > 0) {
    detailParts.push(`${subCategoryCount} sub-${subCategoryCount === 1 ? 'category' : 'categories'}`)
  }
  if (imageCount > 0) {
    detailParts.push(`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`)
  }
  const detailText = detailParts.length > 0 ? detailParts.join(' \u00b7 ') : 'Empty'

  const programChips = category.programIds
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
              sx={{ objectFit: 'cover', objectPosition: 'center' }}
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
          <CardContent sx={{ opacity: category.status === 'hidden' ? 0.5 : 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FolderOutlinedIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
              <Typography variant="h6" noWrap>
                {category.label}
              </Typography>
              {onEditName && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onEditName(category)
                  }}
                  aria-label="Edit category name"
                  sx={{ flexShrink: 0, ml: 0.25 }}
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {detailText}
            </Typography>
            {programChips.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {programChips.map((p) => (
                  <Chip key={p.id} label={p.name} size="small" color="primary" />
                ))}
              </Box>
            )}
            {programChips.length === 0 && ancestorProgramIds.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, opacity: 0.5 }}>
                {ancestorProgramIds
                  .map((pid) => programs.find((p) => p.id === pid))
                  .filter((p): p is Program => p != null)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <Chip key={p.id} label={p.name} size="small" color="primary" />
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
          {onToggleVisibility && (
            <Tooltip title={category.status === 'hidden' ? 'Show to students' : 'Hide from students'}>
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
                  onToggleVisibility(category.id)
                }}
                aria-label="Toggle visibility"
              >
                {category.status === 'hidden' ? (
                  <DisabledVisibleIcon fontSize="small" />
                ) : (
                  <VisibilityIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
          {onSetCardImage && (
            <Tooltip title="Set card image">
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
                <ImageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
