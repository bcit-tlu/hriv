import { useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
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
import DeleteIcon from '@mui/icons-material/Delete'
import InfoIcon from '@mui/icons-material/Info'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { fetchImages, updateImage, deleteImage } from '../api'
import type { ApiImage } from '../api'
import EditImageModal from './EditImageModal'
import type { ImageFormData } from './EditImageModal'
import ReplaceImageModal from './ReplaceImageModal'

interface ManagePageProps {
  onViewImage?: (image: ApiImage) => void
}

export default function ManagePage({ onViewImage }: ManagePageProps) {
  const [images, setImages] = useState<ApiImage[]>([])
  const [loading, setLoading] = useState(true)

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<ApiImage | null>(null)

  // Replace modal state
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacingImage, setReplacingImage] = useState<ApiImage | null>(null)

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

  const handleMenuReplace = () => {
    if (menuImage) {
      setReplacingImage(menuImage)
      setReplaceOpen(true)
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
      <Typography variant="h5" sx={{ mb: 3 }}>
        Images
      </Typography>

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
                <TableCell>Status</TableCell>
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
                  <TableCell>{img.category_id ?? '—'}</TableCell>
                  <TableCell>{img.copyright ?? '—'}</TableCell>
                  <TableCell>{img.origin ?? '—'}</TableCell>
                  <TableCell>{img.program ?? '—'}</TableCell>
                  <TableCell>{img.status ?? '—'}</TableCell>
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
        <MenuItem onClick={handleMenuReplace}>
          <ListItemIcon>
            <SwapHorizIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Replace</ListItemText>
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
        onSave={handleSaveImage}
        image={editingImage}
      />

      {/* Replace image modal */}
      <ReplaceImageModal
        open={replaceOpen}
        onClose={() => {
          setReplaceOpen(false)
          setReplacingImage(null)
        }}
        imageLabel={replacingImage?.label ?? ''}
      />
    </Box>
  )
}
