import { useEffect, useState, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
import { fetchImages, updateImage, deleteImage } from '../api'
import type { ApiImage } from '../api'
import type { Category } from '../types'
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
  const [loading, setLoading] = useState(true)

  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<ApiImage | null>(null)

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false)

  // Action menu state
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuImage, setMenuImage] = useState<ApiImage | null>(null)

  const loadImages = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchImages()
      setImages(data)
    } catch (err) {
      console.error('Failed to load images', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadImages()
  }, [loadImages])

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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5">
          Images
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {onNewCategory && (
            <Button
              variant="contained"
              startIcon={<CreateNewFolderIcon />}
              onClick={onNewCategory}
            >
              New Category
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
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(img)}
                >
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
                  <TableCell>{img.program ?? '—'}</TableCell>
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
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>Delete</ListItemText>
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
        onAddCategory={onAddCategory}
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={loadImages}
      />
    </Box>
  )
}
