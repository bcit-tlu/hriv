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
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import EditIcon from '@mui/icons-material/Edit'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import ImageIcon from '@mui/icons-material/Image'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Visibility from '@mui/icons-material/Visibility'
import type { Category, Group, ImageItem, Program } from '../types'
import { useColorMode } from '../useColorMode'
import { getVisibilityColors } from '../theme'
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
  groups?: Group[]
  /** Called when native files are dropped onto this category tile. */
  onDropFiles?: (categoryId: number, files: File[]) => void
}

export default function CategoryTile({ category, onClick, onMove, onSetCardImage, onToggleVisibility, onEditName, programs, groups = [], onDropFiles }: CategoryTileProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
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

  const groupChips = category.groupIds
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is Group => g != null)
    .sort((a, b) => a.name.localeCompare(b.name))

  const cardImage = category.cardImageId
    ? findImageInCategory(category, category.cardImageId)
    : null

  const isDropTarget = onDropFiles != null

  const isAcceptedDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('Files')
  }, [])

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
    e.dataTransfer.dropEffect = 'copy'
  }, [isAcceptedDrag])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)

    if (e.dataTransfer.types.includes('Files') && onDropFiles) {
      e.stopPropagation()
      onDropFiles(category.id, Array.from(e.dataTransfer.files))
    }
  }, [category.id, onDropFiles])

  return (
    <>
      <Card
        elevation={dragOver ? 8 : 2}
        onDragEnter={isDropTarget ? handleDragEnter : undefined}
        onDragLeave={isDropTarget ? handleDragLeave : undefined}
        onDragOver={isDropTarget ? handleDragOver : undefined}
        onDrop={isDropTarget ? handleDrop : undefined}
        sx={{
          width: '100%',
          maxWidth: 300,
          position: 'relative',
          transition: 'box-shadow 0.15s, outline-color 0.2s, transform 0.15s',
          outline: '3px dashed',
          outlineColor: dragOver ? 'primary.main' : 'transparent',
          outlineOffset: 3,
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
              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.82),
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
        <CardActionArea onClick={() => onClick(category)} sx={{ filter: category.status === 'hidden' ? 'grayscale(100%)' : 'none' }}>
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
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FolderOutlinedIcon fontSize="small" color="primary" sx={{ flexShrink: 0 }} />
              <Typography variant="h6" noWrap sx={{ color: category.status === 'hidden' ? visColors.inactive : 'primary.main' }}>
                {category.label}
              </Typography>
              {onEditName && (
                <IconButton
                  component="span"
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
            {groupChips.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {groupChips.map((g) => (
                  <Chip
                    key={g.id}
                    label={g.name}
                    size="small"
                    color="secondary"
                  />
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
            <Tooltip title={category.status === 'hidden' ? 'Visibility: Show to students' : 'Visibility: Hide from students'}>
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
                aria-label={category.status === 'hidden' ? 'Visibility: Show to students' : 'Visibility: Hide from students'}
              >
                {category.status === 'hidden' ? (
                  <VisibilityOff fontSize="small" />
                ) : (
                  <Visibility fontSize="small" />
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
