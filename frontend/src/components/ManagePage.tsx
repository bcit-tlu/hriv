import { useEffect, useState, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ClearIcon from '@mui/icons-material/Clear'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import DeleteIcon from '@mui/icons-material/Delete'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import InfoIcon from '@mui/icons-material/Info'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { fetchImages, fetchPrograms, updateImage, deleteImage, bulkUpdateImages, bulkDeleteImages } from '../api'
import type { ApiImage } from '../api'
import type { Category, Program } from '../types'
import BulkEditImagesModal from './BulkEditImagesModal'
import EditImageModal from './EditImageModal'
import type { ImageFormData } from './EditImageModal'
import MoveImageDialog from './MoveImageDialog'
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

type SortableColumn = 'id' | 'name' | 'category' | 'copyright' | 'note' | 'program' | 'active' | 'created_at' | 'updated_at'
type SortDirection = 'asc' | 'desc'

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

  // Sort state
  const [sortColumn, setSortColumn] = useState<SortableColumn>('id')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({})
  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<ApiImage | null>(null)

  // Bulk edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false)

  // Move modal state
  const [moveOpen, setMoveOpen] = useState(false)
  const [movingImage, setMovingImage] = useState<ApiImage | null>(null)

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

  // Sort handler
  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Helper to get category label for sorting
  const getCategoryLabel = useCallback((img: ApiImage): string => {
    if (img.category_id == null) return ''
    const seg = categoryPaths.get(img.category_id)
    return seg ? seg.category.label : ''
  }, [categoryPaths])

  // Helper to get program names for sorting
  const getProgramNames = useCallback((img: ApiImage): string => {
    return img.program_ids
      .map((pid) => programs.find((p) => p.id === pid)?.name ?? '')
      .join(', ')
  }, [programs])

  // Filtered and sorted images
  const filteredImages = useMemo(() => {
    if (!hasActiveFilters) return images
    return images.filter((img) => {
      const match = (field: string, value: string) => {
        const filter = filters[field]
        if (!filter) return true
        return value.toLowerCase().includes(filter.toLowerCase())
      }
      if (!match('id', String(img.id))) return false
      if (!match('name', img.name)) return false
      if (!match('category', getCategoryLabel(img))) return false
      if (!match('copyright', img.copyright ?? '')) return false
      if (!match('note', img.note ?? '')) return false
      if (!match('program', getProgramNames(img))) return false
      const statusFilter = filters['active']
      if (statusFilter) {
        if (statusFilter === 'active' && !img.active) return false
        if (statusFilter === 'inactive' && img.active) return false
      }
      return true
    })
  }, [images, filters, hasActiveFilters, getCategoryLabel, getProgramNames])

  const sortedImages = useMemo(() => {
    const sorted = [...filteredImages]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'category':
          cmp = getCategoryLabel(a).localeCompare(getCategoryLabel(b))
          break
        case 'copyright':
          cmp = (a.copyright ?? '').localeCompare(b.copyright ?? '')
          break
        case 'note':
          cmp = (a.note ?? '').localeCompare(b.note ?? '')
          break
        case 'program':
          cmp = getProgramNames(a).localeCompare(getProgramNames(b))
          break
        case 'active':
          cmp = Number(a.active) - Number(b.active)
          break
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case 'updated_at':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredImages, sortColumn, sortDirection, getCategoryLabel, getProgramNames])

  const handleFilterChange = (column: string, value: string) => {
    setFilters((prev) => ({ ...prev, [column]: value }))
  }

  const handleClearFilters = () => {
    setFilters({})
  }

  const selectedInView = useMemo(
    () => sortedImages.filter((img) => selected.has(img.id)).length,
    [sortedImages, selected],
  )

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(sortedImages.map((img) => img.id)))
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
    note?: string
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

  // Row click -> open edit modal
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

  // Toggle active status via switch
  const handleToggleActive = async (image: ApiImage) => {
    try {
      await updateImage(image.id, { active: !image.active })
      await loadImages()
    } catch (err) {
      console.error('Failed to toggle image status', err)
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

  // Move image handler
  const handleMoveImage = async (categoryId: number | null) => {
    if (!movingImage) return
    try {
      await updateImage(movingImage.id, { category_id: categoryId })
      setMoveOpen(false)
      setMovingImage(null)
      await loadImages()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to move image', err)
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

  const handleMenuMove = () => {
    if (menuImage) {
      setMovingImage(menuImage)
      setMoveOpen(true)
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
            <Button
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => setBulkEditOpen(true)}
            >
              Bulk Edit ({selected.size} selected)
            </Button>
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
                    indeterminate={selectedInView > 0 && selectedInView < sortedImages.length}
                    checked={sortedImages.length > 0 && selectedInView === sortedImages.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </TableCell>
                <TableCell sortDirection={sortColumn === 'id' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'id'}
                    direction={sortColumn === 'id' ? sortDirection : 'asc'}
                    onClick={() => handleSort('id')}
                  >
                    ID
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'name' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'name'}
                    direction={sortColumn === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'category' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'category'}
                    direction={sortColumn === 'category' ? sortDirection : 'asc'}
                    onClick={() => handleSort('category')}
                  >
                    Category
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'copyright' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'copyright'}
                    direction={sortColumn === 'copyright' ? sortDirection : 'asc'}
                    onClick={() => handleSort('copyright')}
                  >
                    Copyright
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'note' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'note'}
                    direction={sortColumn === 'note' ? sortDirection : 'asc'}
                    onClick={() => handleSort('note')}
                  >
                    Note
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'program' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'program'}
                    direction={sortColumn === 'program' ? sortDirection : 'asc'}
                    onClick={() => handleSort('program')}
                  >
                    Program
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'active' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'active'}
                    direction={sortColumn === 'active' ? sortDirection : 'asc'}
                    onClick={() => handleSort('active')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'created_at' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'created_at'}
                    direction={sortColumn === 'created_at' ? sortDirection : 'asc'}
                    onClick={() => handleSort('created_at')}
                  >
                    Created
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'updated_at' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'updated_at'}
                    direction={sortColumn === 'updated_at' ? sortDirection : 'asc'}
                    onClick={() => handleSort('updated_at')}
                  >
                    Modified
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
              <TableRow>
                <TableCell padding="checkbox">
                  {hasActiveFilters && (
                    <IconButton size="small" onClick={handleClearFilters} title="Clear all filters">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['id'] ?? ''}
                    onChange={(e) => handleFilterChange('id', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['id'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('id', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['name'] ?? ''}
                    onChange={(e) => handleFilterChange('name', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['name'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('name', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['category'] ?? ''}
                    onChange={(e) => handleFilterChange('category', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['category'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('category', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['copyright'] ?? ''}
                    onChange={(e) => handleFilterChange('copyright', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['copyright'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('copyright', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['note'] ?? ''}
                    onChange={(e) => handleFilterChange('note', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['note'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('note', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['program'] ?? ''}
                    onChange={(e) => handleFilterChange('program', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['program'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('program', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <FormControl size="small" variant="standard" fullWidth>
                    <Select
                      value={filters['active'] ?? ''}
                      onChange={(e: SelectChangeEvent) => handleFilterChange('active', e.target.value)}
                      displayEmpty
                      sx={{ fontSize: '0.8rem' }}
                    >
                      <MenuItem value=""><em>All</em></MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="inactive">Inactive</MenuItem>
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedImages.map((img) => (
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
                  <TableCell>{img.name}</TableCell>
                  <TableCell>
                    <CategoryBreadcrumb
                      categoryId={img.category_id}
                      categoryPaths={categoryPaths}
                      onNavigate={onNavigateCategory}
                    />
                  </TableCell>
                  <TableCell>{img.copyright ?? '—'}</TableCell>
                  <TableCell>{img.note ?? '—'}</TableCell>
                  <TableCell>
                    {img.program_ids.length > 0
                      ? img.program_ids
                          .map((pid) => programs.find((p) => p.id === pid)?.name ?? pid)
                          .join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      size="small"
                      checked={img.active}
                      onChange={() => handleToggleActive(img)}
                    />
                  </TableCell>
                  <TableCell>
                    {new Date(img.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {new Date(img.updated_at).toLocaleDateString()}
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
        <MenuItem onClick={handleMenuMove}>
          <ListItemIcon>
            <DriveFileMoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Move</ListItemText>
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

      {/* Move image modal */}
      <MoveImageDialog
        open={moveOpen}
        onClose={() => {
          setMoveOpen(false)
          setMovingImage(null)
        }}
        onMove={handleMoveImage}
        image={movingImage}
        categories={categories}
        onAddCategory={onAddCategory}
      />
    </Box>
  )
}
