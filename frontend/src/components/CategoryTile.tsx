import { useCallback, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'
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
import { MIME_HRIV_IMAGE } from './ImageTile'
import CardImagePickerModal from './CardImagePickerModal'

export const MIME_HRIV_CATEGORY = 'application/x-hriv-category'

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
  /** Called when an image is dropped onto this category tile. */
  onDropImage?: (imageId: number, categoryId: number) => void
  /** Called when another category is dropped onto this category tile (reparent). */
  onDropCategory?: (draggedCategoryId: number, targetCategoryId: number) => void
  /** Called when native files are dropped onto this category tile. */
  onDropFiles?: (categoryId: number, files: File[]) => void
  /** Enable HTML5 drag for this tile (editors only). */
  draggable?: boolean
}

export default function CategoryTile({ category, onClick, onMove, onSetCardImage, onToggleVisibility, onEditName, programs, onDropImage, onDropCategory, onDropFiles, draggable = false }: CategoryTileProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)

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

  const isDropTarget = onDropImage != null || onDropCategory != null || onDropFiles != null

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(MIME_HRIV_CATEGORY, JSON.stringify({ id: category.id }))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }, [category.id])

  const handleDragEnd = useCallback(() => {
    setDragging(false)
  }, [])

  const isAcceptedDrag = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    return types.includes(MIME_HRIV_IMAGE) || types.includes(MIME_HRIV_CATEGORY) || (onDropFiles != null && types.includes('Files'))
  }, [onDropFiles])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return
    e.preventDefault()
    dragCounter.current += 1
    if (dragCounter.current === 1) setDragOver(true)
  }, [isAcceptedDrag])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return
    dragCounter.current -= 1
    if (dragCounter.current === 0) setDragOver(false)
  }, [isAcceptedDrag])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
  }, [isAcceptedDrag])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)

    const imageData = e.dataTransfer.getData(MIME_HRIV_IMAGE)
    if (imageData && onDropImage) {
      try {
        const { id } = JSON.parse(imageData) as { id: number }
        onDropImage(id, category.id)
      } catch { /* ignore malformed data */ }
      return
    }

    const categoryData = e.dataTransfer.getData(MIME_HRIV_CATEGORY)
    if (categoryData && onDropCategory) {
      try {
        const { id } = JSON.parse(categoryData) as { id: number }
        if (id !== category.id) {
          onDropCategory(id, category.id)
        }
      } catch { /* ignore malformed data */ }
      return
    }

    if (e.dataTransfer.types.includes('Files') && onDropFiles) {
      e.stopPropagation()
      onDropFiles(category.id, Array.from(e.dataTransfer.files))
    }
  }, [category.id, onDropImage, onDropCategory, onDropFiles])

  return (
    <>
      <Card
        elevation={dragOver ? 8 : 2}
        draggable={draggable}
        onDragStart={draggable ? handleDragStart : undefined}
        onDragEnd={draggable ? handleDragEnd : undefined}
        onDragEnter={isDropTarget ? handleDragEnter : undefined}
        onDragLeave={isDropTarget ? handleDragLeave : undefined}
        onDragOver={isDropTarget ? handleDragOver : undefined}
        onDrop={isDropTarget ? handleDrop : undefined}
        sx={{
          width: '100%',
          maxWidth: 300,
          position: 'relative',
          opacity: dragging ? 0.4 : 1,
          transition: 'opacity 0.15s, box-shadow 0.15s, border-color 0.2s, transform 0.15s',
          border: dragOver ? '3px dashed' : '3px solid transparent',
          borderColor: dragOver ? 'primary.main' : 'transparent',
          transform: dragOver ? 'scale(1.03)' : 'scale(1)',
        }}
      >
        {/* Drag-over overlay indicating drop target */}
        {dragOver && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.10),
              borderRadius: 'inherit',
              pointerEvents: 'none',
              gap: 0.5,
            }}
          >
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <DriveFileMoveIcon sx={{ fontSize: 22 }} />
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main' }}>
              Drop here
            </Typography>
          </Box>
        )}
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
