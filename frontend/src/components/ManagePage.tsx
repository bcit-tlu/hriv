import { useEffect, useState, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import DeleteIcon from '@mui/icons-material/Delete'
import InfoIcon from '@mui/icons-material/Info'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { fetchImages, fetchPrograms, updateImage, deleteImage, bulkUpdateImages, bulkDeleteImages } from '../api'
import type { ApiImage } from '../api'
import type { Category, Program } from '../types'
import BulkEditImagesModal from './BulkEditImagesModal'
import EditImageModal from './EditImageModal'
import type { ImageFormData } from './EditImageModal'
import UploadImageModal from './UploadImageModal'

interface CategoryPathSegment {
  category: Category
  ancestors: Category[]
}

function buildCategoryPaths(
  nodes: Category[],
  ancestors: Category[] = [],
): Map<number, CategoryPathSegment> {
  const map = new Map<number, CategoryPathSegment>()
  for (const node of nodes) {
    map.set(node.id, { category: node, ancestors })
    const childMap = buildCategoryPaths(node.children, [...ancestors, node])
    for (const [id, seg] of childMap) {
      map.set(id, seg)
    }
  }
  return map
}

function CategoryBreadcrumb({
  categoryId,
  categoryPaths,
  onNavigate,
}: {
  categoryId: number | null
  categoryPaths: Map<number, CategoryPathSegment>
  onNavigate?: (categoryPath: Category[]) => void
}) {
  if (categoryId == null) return <>—</>
  const seg = categoryPaths.get(categoryId)
  if (!seg) return <>{categoryId}</>

  const fullPath = [...seg.ancestors, seg.category]

  return (
    <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' }}>
      {fullPath.map((cat, i) => (
        <Box component="span" key={cat.id}>
          {i > 0 && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ mx: 0.25 }}>
              :
            </Typography>
          )}
          <Link
            component="button"
            variant="body2"
            underline="hover"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              if (onNavigate) {
                onNavigate(fullPath.slice(0, i + 1))
              }
            }}
            sx={{ verticalAlign: 'baseline' }}
          >
            {cat.label}
          </Link>
        </Box>
      ))}
    </Box>
  )
}

interface ManagePageProps {
  categories: Category[]
  onViewImage?: (image: ApiImage) => void
  onNavigateCategory?: (categoryPath: Category[]) => void
  onCategoriesChanged?: () => void
  onNewCategory?: () => void
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
}

export default function ManagePage({ categories, onViewImage, onNavigateCategory, onCategoriesChanged, onNewCategory, onAddCategory }: ManagePageProps) {
  const [images, setImages] = useState<ApiImage[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<ApiImage | null>(null)

  // Bulk edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false)

  // Action menu state
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuImage, setMenuImage] = useState<ApiImage | null>(null)

  const loadImages = useCallback(async () => {
    try {
      setLoading(true)
      const [data, progs] = await Promise.all([fetchImages(), fetchPrograms()])
      setImages(data)
      setPrograms(progs)
    } catch (err) {
      console.error('Failed to load images', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(images.map((img) => img.id)))
    } else {
      setSelected(new Set())
    }
  }

  const handleSelectOne = (imageId: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(imageId)
      } else {
        next.delete(imageId)
      }
      return next
    })
  }

  // Bulk edit handlers
  const handleBulkSave = async (data: {
    category_id?: number | null
    copyright?: string
    origin?: string
    program_ids?: number[]
    active?: boolean
  }) => {
    try {
      await bulkUpdateImages({
        image_ids: Array.from(selected),
        ...data,
      })
      setBulkEditOpen(false)
      setSelected(new Set())
      await loadImages()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to bulk update images', err)
      throw err
    }
  }

  const handleBulkDelete = async () => {
    try {
      await bulkDeleteImages({ image_ids: Array.from(selected) })
      setBulkEditOpen(false)
      setSelected(new Set())
      await loadImages()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to bulk delete images', err)
      throw err
    }
  }

  // Row click → open edit modal
  const handleRowClick = (image: ApiImage) => {
    setEditingImage(image)
    setEditOpen(true)
  }

  // Save edited image metadata
  const handleSaveImage = async (data: ImageFormData) => {
    if (!editingImage) return
    try {
      await updateImage(editingImage.id, data)
      setEditOpen(false)
      setEditingImage(null)
      await loadImages()
    } catch (err) {
      console.error('Failed to update image', err)
    }
  }

  // Delete image
  const handleDeleteImage = async (image: ApiImage) => {
    try {
      await deleteImage(image.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(image.id)
        return next
      })
      await loadImages()
    } catch (err) {
      console.error('Failed to delete image', err)
    }
  }

  // Action menu handlers
  const handleMenuOpen = (
    e: React.MouseEvent<HTMLElement>,
    image: ApiImage,
  ) => {
    setMenuAnchor(e.currentTarget)
    setMenuImage(image)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setMenuImage(null)
  }

  const handleMenuView = () => {
    if (menuImage && onViewImage) {
      onViewImage(menuImage)
    }
    handleMenuClose()
  }

  const handleMenuDetails = () => {
    if (menuImage) {
      setEditingImage(menuImage)
      setEditOpen(true)
    }
    handleMenuClose()
  }

  const handleMenuDelete = () => {
    if (menuImage) {
      handleDeleteImage(menuImage)
    }
    handleMenuClose()
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">
          Images
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          {selected.size > 0 && (
            <Link
              component="button"
              variant="body2"
              underline="always"
              onClick={() => setBulkEditOpen(true)}
              sx={{ cursor: 'pointer' }}
            >
              bulk edit ({selected.size} selected)
            </Link>
          )}
          {onNewCategory && (
            <Button
              variant="contained"
              startIcon={<CreateNewFolderIcon />}
              onClick={onNewCategory}
            >
              Add/Edit Categories
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<AddPhotoAlternateIcon />}
            onClick={() => setUploadOpen(true)}
          >
            Upload Image
          </Button>
        </Box>
      </Box>

      {images.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          No images found.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selected.size > 0 && selected.size < images.length}
                    checked={images.length > 0 && selected.size === images.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Label</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Copyright</TableCell>
                <TableCell>Origin</TableCell>
                <TableCell>Program</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {images.map((img) => (
                <TableRow
                  key={img.id}
                  hover
                  selected={selected.has(img.id)}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(img)}
                >
                  <TableCell
                    padding="checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(img.id)}
                      onChange={(e) =>
                        handleSelectOne(img.id, e.target.checked)
                      }
                    />
                  </TableCell>
                  <TableCell>{img.id}</TableCell>
                  <TableCell>{img.label}</TableCell>
                  <TableCell>
                    <CategoryBreadcrumb
                      categoryId={img.category_id}
                      categoryPaths={categoryPaths}
                      onNavigate={onNavigateCategory}
                    />
                  </TableCell>
                  <TableCell>{img.copyright ?? '—'}</TableCell>
                  <TableCell>{img.origin ?? '—'}</TableCell>
                  <TableCell>
                    {img.program_ids.length > 0
                      ? img.program_ids
                          .map((pid) => programs.find((p) => p.id === pid)?.name ?? pid)
                          .join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell>{img.active ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    {new Date(img.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell
                    align="right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      size="small"
                      aria-label="actions"
                      onClick={(e) => handleMenuOpen(e, img)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Action menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleMenuView} disabled={!onViewImage}>
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleMenuDetails}>
          <ListItemIcon>
            <InfoIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Details</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleMenuDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="primary" />
          </ListItemIcon>
          <ListItemText sx={{ color: 'primary.main' }}>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Edit image modal */}
      <EditImageModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false)
          setEditingImage(null)
        }}
        onSave={async (data) => {
          await handleSaveImage(data)
          onCategoriesChanged?.()
        }}
        image={editingImage}
        categories={categories}
        programs={programs}
        onAddCategory={onAddCategory}
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={loadImages}
        programs={programs}
      />

      {/* Bulk edit images modal */}
      <BulkEditImagesModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkSave}
        onDelete={handleBulkDelete}
        categories={categories}
        programs={programs}
        selectedCount={selected.size}
        onAddCategory={onAddCategory}
      />
    </Box>
  )
}
