import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ClearIcon from '@mui/icons-material/Clear'
import DeleteIcon from '@mui/icons-material/Delete'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import InfoIcon from '@mui/icons-material/Info'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import {
  fetchImages,
  updateImage,
  deleteImage,
  replaceImage,
  bulkUpdateImages,
  bulkDeleteImages,
} from '../api'
import type { ApiBulkImportJob, ApiImage } from '../api'
import type { Category, Group, Program } from '../types'
import { splitDirectAncestorGroupIds, splitDirectAncestorProgramIds } from '../categoryUtils'
import { formatFileSize } from '../formatUtils'
import { getVisibilityColors } from '../theme'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import { useColorMode } from '../useColorMode'
import BulkEditImagesModal from './BulkEditImagesModal'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import EditImageModal from './EditImageModal'
import type { ImageFormData, ReplaceImageData } from './EditImageModal'
import FilterBar from './FilterBar'
import MoveImageDialog from './MoveImageDialog'
import NoteDisplay from './NoteDisplay'
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

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [
    ...new Set(Array.from(values, (value) => value.trim()).filter((value) => value.length > 0)),
  ].sort((a, b) => a.localeCompare(b))
}

function CategoryBreadcrumb({
  categoryId,
  categoryPaths,
  onNavigate,
  hiddenColor,
}: {
  categoryId: number | null
  categoryPaths: Map<number, CategoryPathSegment>
  onNavigate?: (categoryPath: Category[]) => void
  hiddenColor?: string
}) {
  if (categoryId == null) return <>—</>
  const seg = categoryPaths.get(categoryId)
  if (!seg) return <>{categoryId}</>

  const fullPath = [...seg.ancestors, seg.category]
  const hiddenState = getCategoryHiddenStateFromPath(fullPath)

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
      {hiddenState.hidden && hiddenColor && (
        <Tooltip title="Hidden by category">
          <span
            role="img"
            aria-label={
              hiddenState.hiddenByAncestor && !hiddenState.directlyHidden
                ? 'Category hidden from students by ancestor'
                : 'Category hidden from students'
            }
            style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle' }}
          >
            <VisibilityOffIcon
              sx={{
                fontSize: 14,
                color: hiddenColor,
                opacity: hiddenState.hiddenByAncestor && !hiddenState.directlyHidden ? 0.55 : 1,
              }}
            />
          </span>
        </Tooltip>
      )}
    </Box>
  )
}

type SortableColumn =
  | 'id'
  | 'name'
  | 'category'
  | 'copyright'
  | 'note'
  | 'program'
  | 'group'
  | 'active'
  | 'updated_at'
  | 'created_at'
  | 'dimensions'
  | 'file_size'
type SortDirection = 'asc' | 'desc'
type ManageTableColumn =
  | 'thumbnail'
  | 'id'
  | 'name'
  | 'category'
  | 'copyright'
  | 'note'
  | 'program'
  | 'group'
  | 'active'
  | 'updated_at'
  | 'created_at'
  | 'dimensions'
  | 'file_size'
  | 'measurement'

const MANAGE_COLUMN_OPTIONS: readonly ColumnVisibilityOption<ManageTableColumn>[] = [
  { key: 'thumbnail', label: 'Thumbnail' },
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'note', label: 'Note' },
  { key: 'program', label: 'Program' },
  { key: 'group', label: 'Groups' },
  { key: 'active', label: 'Visibility' },
  { key: 'updated_at', label: 'Modified' },
  { key: 'created_at', label: 'Created' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'file_size', label: 'File Size' },
  { key: 'measurement', label: 'Measurement' },
]

const MANAGE_DEFAULT_VISIBLE_COLUMNS: readonly ManageTableColumn[] = [
  'thumbnail',
  'name',
  'category',
  'group',
  'active',
  'updated_at',
]
const MANAGE_ALL_COLUMNS: readonly ManageTableColumn[] = MANAGE_COLUMN_OPTIONS.map(
  (column) => column.key,
)

const MANAGE_COLUMN_FILTER_KEYS: Partial<Record<ManageTableColumn, string>> = {
  id: 'id',
  name: 'name',
  category: 'category',
  copyright: 'copyright',
  note: 'note',
  program: 'program',
  group: 'group',
  active: 'active',
}

interface ManagePageProps {
  categories: Category[]
  programs: Program[]
  groups?: Group[]
  imagesVersion?: number
  onViewImage?: (image: ApiImage) => void
  onNavigateCategory?: (categoryPath: Category[]) => void
  onCategoriesChanged?: () => void
  onAddCategory?: (
    label: string,
    parentId: number | null,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<number | void>
  onEditCategory?: (
    categoryId: number,
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<void>
  onToggleVisibility?: (categoryId: number) => Promise<void>
  onReplaceImage?: (sourceImageId: number, filename: string, fileSize: number) => void
  onProcessingStarted?: (
    sourceImageId: number,
    filename: string,
    fileSize: number,
    uploadId: number,
  ) => void
  onUploadStarted?: (uploadId: number, filename: string, fileSize: number) => void
  onUploadProgress?: (uploadId: number, fraction: number) => void
  onBulkImportStarted?: (
    job: ApiBulkImportJob,
    filename: string,
    fileSize: number,
    uploadId: number,
  ) => void
  onUploadFailed?: (uploadId: number, error: string) => void
  onUploadOpenChange?: (isOpen: boolean) => void
  onSearchProgram?: (programName: string) => void
  initialProgramFilter?: string
  onInitialProgramFilterConsumed?: () => void
}

export default function ManagePage({
  categories,
  programs,
  groups = [],
  imagesVersion,
  onViewImage,
  onNavigateCategory,
  onCategoriesChanged,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  onReplaceImage,
  onProcessingStarted,
  onUploadStarted,
  onUploadProgress,
  onBulkImportStarted,
  onUploadFailed,
  onUploadOpenChange,
  onSearchProgram,
  initialProgramFilter,
  onInitialProgramFilterConsumed,
}: ManagePageProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const [images, setImages] = useState<ApiImage[]>([])
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

  // Notify parent when upload modal open state changes (#409)
  useEffect(() => {
    onUploadOpenChange?.(uploadOpen)
  }, [uploadOpen, onUploadOpenChange])

  // Replace-image abort controller and progress
  const replaceAbortRef = useRef<AbortController | null>(null)
  const [replaceProgress, setReplaceProgress] = useState<number | undefined>(undefined)

  // Move modal state
  const [moveOpen, setMoveOpen] = useState(false)
  const [movingImage, setMovingImage] = useState<ApiImage | null>(null)

  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const { visibleColumns, isColumnVisible, setColumnVisible } =
    useTableColumnPreferences<ManageTableColumn>({
      tableKey: 'manage-images',
      allColumns: MANAGE_ALL_COLUMNS,
      defaultVisibleColumns: MANAGE_DEFAULT_VISIBLE_COLUMNS,
    })

  // Pagination state
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [currentPage, setCurrentPage] = useState(0)

  // Apply initial program filter from external navigation (e.g. search)
  const [prevInitialProgramFilter, setPrevInitialProgramFilter] = useState(initialProgramFilter)
  if (initialProgramFilter !== prevInitialProgramFilter) {
    setPrevInitialProgramFilter(initialProgramFilter)
    if (initialProgramFilter) {
      setFilters((prev) => ({ ...prev, program: initialProgramFilter }))
      setColumnVisible('program', true)
      setCurrentPage(0)
      onInitialProgramFilterConsumed?.()
    }
  }

  // Action menu state
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuImage, setMenuImage] = useState<ApiImage | null>(null)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogImage, setDeleteDialogImage] = useState<ApiImage | null>(null)
  const [deleting, setDeleting] = useState(false)

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
    loadImages() // eslint-disable-line react-hooks/set-state-in-effect -- standard data-fetch trigger on dependency change
  }, [loadImages, imagesVersion])

  // Sort handler
  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Helper to get full category path string for sorting and filtering
  const getCategoryLabel = useCallback(
    (img: ApiImage): string => {
      if (img.category_id == null) return ''
      const seg = categoryPaths.get(img.category_id)
      if (!seg) return ''
      const fullPath = [...seg.ancestors, seg.category]
      return fullPath.map((c) => c.label).join(' : ')
    },
    [categoryPaths],
  )

  // Collect effective program restrictions from the category tree using narrowing
  // semantics: each category with own programIds narrows (intersects) the set.
  // "direct" = programs from the image's own category, "ancestor" = remaining inherited.
  const getInheritedProgramIds = useCallback(
    (img: ApiImage): { direct: number[]; ancestor: number[] } => {
      if (img.category_id == null) return { direct: [], ancestor: [] }
      const seg = categoryPaths.get(img.category_id)
      if (!seg) return { direct: [], ancestor: [] }
      return splitDirectAncestorProgramIds([...seg.ancestors, seg.category])
    },
    [categoryPaths],
  )

  // Helper to get program names for sorting/filtering
  const getProgramNames = useCallback(
    (img: ApiImage): string => {
      const { direct, ancestor } = getInheritedProgramIds(img)
      return [...direct, ...ancestor]
        .map((pid) => programs.find((p) => p.id === pid)?.name ?? '')
        .join(', ')
    },
    [programs, getInheritedProgramIds],
  )

  const getInheritedGroupIds = useCallback(
    (img: ApiImage): { direct: number[]; ancestor: number[] } => {
      if (img.category_id == null) return { direct: [], ancestor: [] }
      const seg = categoryPaths.get(img.category_id)
      if (!seg) return { direct: [], ancestor: [] }
      return splitDirectAncestorGroupIds([...seg.ancestors, seg.category])
    },
    [categoryPaths],
  )

  const getGroupNames = useCallback(
    (img: ApiImage): string => {
      const { direct, ancestor } = getInheritedGroupIds(img)
      return [...direct, ...ancestor]
        .map((gid) => groups.find((g) => g.id === gid)?.name ?? '')
        .join(', ')
    },
    [groups, getInheritedGroupIds],
  )

  const idFilterOptions = useMemo(
    () => uniqueSortedStrings(images.map((image) => String(image.id))),
    [images],
  )
  const nameFilterOptions = useMemo(
    () => uniqueSortedStrings(images.map((image) => image.name)),
    [images],
  )
  const categoryFilterOptions = useMemo(
    () => uniqueSortedStrings(images.map((image) => getCategoryLabel(image))),
    [images, getCategoryLabel],
  )
  const copyrightFilterOptions = useMemo(
    () => uniqueSortedStrings(images.map((image) => image.copyright ?? '')),
    [images],
  )
  const noteFilterOptions = useMemo(
    () => uniqueSortedStrings(images.map((image) => image.note ?? '')),
    [images],
  )
  const programFilterOptions = useMemo(
    () => uniqueSortedStrings(programs.map((program) => program.name)),
    [programs],
  )
  const groupFilterOptions = useMemo(
    () => uniqueSortedStrings(groups.map((group) => group.name)),
    [groups],
  )

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
      if (!match('group', getGroupNames(img))) return false
      const statusFilter = filters['active']
      if (statusFilter) {
        if (statusFilter === 'active' && !img.active) return false
        if (statusFilter === 'inactive' && img.active) return false
      }
      return true
    })
  }, [images, filters, hasActiveFilters, getCategoryLabel, getProgramNames, getGroupNames])

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
        case 'group':
          cmp = getGroupNames(a).localeCompare(getGroupNames(b))
          break
        case 'active':
          cmp = Number(a.active) - Number(b.active)
          break
        case 'updated_at':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
          break
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case 'dimensions':
          cmp = (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0)
          break
        case 'file_size':
          cmp = (a.file_size ?? 0) - (b.file_size ?? 0)
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredImages, sortColumn, sortDirection, getCategoryLabel, getProgramNames, getGroupNames])

  // Auto-correct currentPage when dataset shrinks (e.g. after delete/bulk-delete)
  const maxPage = Math.max(0, Math.ceil(sortedImages.length / rowsPerPage) - 1)
  if (currentPage > maxPage) {
    setCurrentPage(maxPage)
  }

  const handleFilterChange = (column: string, value: string) => {
    setFilters((prev) => ({ ...prev, [column]: value }))
    setCurrentPage(0)
  }

  const handleClearFilters = () => {
    setFilters({})
    setCurrentPage(0)
  }

  const handleColumnVisibilityToggle = useCallback(
    (column: ManageTableColumn) => {
      const nextVisible = !visibleColumns[column]
      setColumnVisible(column, nextVisible)
      if (!nextVisible) {
        setCurrentPage(0)
        const filterKey = MANAGE_COLUMN_FILTER_KEYS[column]
        if (filterKey) {
          setFilters((prev) => {
            if (!prev[filterKey]) return prev
            const next = { ...prev }
            delete next[filterKey]
            return next
          })
        }
      }
    },
    [setColumnVisible, visibleColumns],
  )

  const pageImages = sortedImages.slice(
    currentPage * rowsPerPage,
    currentPage * rowsPerPage + rowsPerPage,
  )

  const selectedInView = useMemo(
    () => pageImages.filter((img) => selected.has(img.id)).length,
    [pageImages, selected],
  )

  // Selection handlers — scoped to current page only
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected((prev) => {
        const next = new Set(prev)
        pageImages.forEach((img) => next.add(img.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        pageImages.forEach((img) => next.delete(img.id))
        return next
      })
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

  const isImageCategoryHidden = useCallback(
    (img: ApiImage): boolean => {
      if (img.category_id == null) return false
      const seg = categoryPaths.get(img.category_id)
      if (!seg) return false
      return getCategoryHiddenStateFromPath([...seg.ancestors, seg.category]).hidden
    },
    [categoryPaths],
  )

  // Toggle active status via switch
  const handleToggleActive = async (image: ApiImage) => {
    const nextActive = !image.active
    setImages((prev) =>
      prev.map((item) => (item.id === image.id ? { ...item, active: nextActive } : item)),
    )
    try {
      const updated = await updateImage(image.id, { active: nextActive }, image.version)
      setImages((prev) =>
        prev.map((item) =>
          item.id === image.id
            ? {
                ...item,
                active: updated.active,
                version: updated.version,
                updated_at: updated.updated_at,
              }
            : item,
        ),
      )
    } catch (err) {
      setImages((prev) =>
        prev.map((item) => (item.id === image.id ? { ...item, active: image.active } : item)),
      )
      console.error('Failed to toggle image status', err)
      throw err
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
  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, image: ApiImage) => {
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
    const image = menuImage
    handleMenuClose()
    if (image) {
      setDeleteDialogImage(image)
      setDeleteDialogOpen(true)
      setDeleting(false)
    }
  }

  const handleConfirmDeleteImage = async () => {
    if (!deleteDialogImage) return
    setDeleting(true)
    try {
      await deleteImage(deleteDialogImage.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(deleteDialogImage.id)
        return next
      })
      setDeleteDialogOpen(false)
      setDeleteDialogImage(null)
      setDeleting(false)
      await loadImages()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to delete image', err)
      setDeleting(false)
    }
  }

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false)
    setDeleteDialogImage(null)
    setDeleting(false)
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
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 3,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h5">Images</Typography>
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
          <Button
            variant="contained"
            startIcon={<AddPhotoAlternateIcon />}
            onClick={() => setUploadOpen(true)}
          >
            Add Images
          </Button>
        </Box>
      </Box>

      <FilterBar
        summary={
          hasActiveFilters ? (
            <>
              {Object.entries(filters)
                .filter(([, value]) => value.trim().length > 0)
                .map(([key, value]) => {
                  const labels: Record<string, string> = {
                    id: 'ID',
                    name: 'Name',
                    category: 'Category',
                    copyright: 'Copyright',
                    note: 'Note',
                    program: 'Program',
                    group: 'Groups',
                    active: 'Visibility',
                  }
                  const displayValue =
                    key === 'active' ? (value === 'active' ? 'Visible' : 'Hidden') : value
                  return (
                    <Chip
                      key={key}
                      label={`${labels[key]}: ${displayValue}`}
                      size="small"
                      variant="outlined"
                      onDelete={() => handleFilterChange(key, '')}
                    />
                  )
                })}
              <Button
                size="small"
                startIcon={<ClearIcon fontSize="small" />}
                onClick={handleClearFilters}
              >
                Clear filters
              </Button>
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              size="small"
              startIcon={<ViewColumnIcon fontSize="small" />}
              aria-label="Choose columns"
              onClick={() => setColumnDialogOpen(true)}
            >
              Choose columns
            </Button>
          </>
        }
      >
        {isColumnVisible('id') && (
          <Autocomplete
            freeSolo
            size="small"
            options={idFilterOptions}
            value={filters['id'] ?? ''}
            inputValue={filters['id'] ?? ''}
            onChange={(_, value) => handleFilterChange('id', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('id', value)}
            sx={{ width: 110 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="ID"
                inputProps={{ ...params.inputProps, 'aria-label': 'ID' }}
              />
            )}
          />
        )}
        {isColumnVisible('name') && (
          <Autocomplete
            freeSolo
            size="small"
            options={nameFilterOptions}
            value={filters['name'] ?? ''}
            inputValue={filters['name'] ?? ''}
            onChange={(_, value) => handleFilterChange('name', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('name', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Name"
                inputProps={{ ...params.inputProps, 'aria-label': 'Name' }}
              />
            )}
          />
        )}
        {isColumnVisible('category') && (
          <Autocomplete
            freeSolo
            size="small"
            options={categoryFilterOptions}
            value={filters['category'] ?? ''}
            inputValue={filters['category'] ?? ''}
            onChange={(_, value) => handleFilterChange('category', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('category', value)}
            sx={{ width: 200 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Category"
                inputProps={{ ...params.inputProps, 'aria-label': 'Category' }}
              />
            )}
          />
        )}
        {isColumnVisible('copyright') && (
          <Autocomplete
            freeSolo
            size="small"
            options={copyrightFilterOptions}
            value={filters['copyright'] ?? ''}
            inputValue={filters['copyright'] ?? ''}
            onChange={(_, value) => handleFilterChange('copyright', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('copyright', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Copyright"
                inputProps={{ ...params.inputProps, 'aria-label': 'Copyright' }}
              />
            )}
          />
        )}
        {isColumnVisible('note') && (
          <Autocomplete
            freeSolo
            size="small"
            options={noteFilterOptions}
            value={filters['note'] ?? ''}
            inputValue={filters['note'] ?? ''}
            onChange={(_, value) => handleFilterChange('note', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('note', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Note"
                inputProps={{ ...params.inputProps, 'aria-label': 'Note' }}
              />
            )}
          />
        )}
        {isColumnVisible('program') && (
          <Autocomplete
            freeSolo
            size="small"
            options={programFilterOptions}
            value={filters['program'] ?? ''}
            inputValue={filters['program'] ?? ''}
            onChange={(_, value) => handleFilterChange('program', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('program', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Program"
                inputProps={{ ...params.inputProps, 'aria-label': 'Program' }}
              />
            )}
          />
        )}
        {isColumnVisible('group') && (
          <Autocomplete
            freeSolo
            size="small"
            options={groupFilterOptions}
            value={filters['group'] ?? ''}
            inputValue={filters['group'] ?? ''}
            onChange={(_, value) => handleFilterChange('group', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('group', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Groups"
                inputProps={{ ...params.inputProps, 'aria-label': 'Groups' }}
              />
            )}
          />
        )}
        {isColumnVisible('active') && (
          <Autocomplete
            size="small"
            options={[
              { label: 'Visible', value: 'active' },
              { label: 'Hidden', value: 'inactive' },
            ]}
            getOptionLabel={(option) => option.label}
            value={
              filters['active']
                ? {
                    label: filters['active'] === 'active' ? 'Visible' : 'Hidden',
                    value: filters['active'],
                  }
                : null
            }
            isOptionEqualToValue={(option, value) => option.value === value.value}
            onChange={(_, value) => handleFilterChange('active', value?.value ?? '')}
            sx={{ width: 160 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Visibility"
                inputProps={{ ...params.inputProps, 'aria-label': 'Visibility' }}
              />
            )}
          />
        )}
        {!isColumnVisible('id') &&
          !isColumnVisible('name') &&
          !isColumnVisible('category') &&
          !isColumnVisible('copyright') &&
          !isColumnVisible('note') &&
          !isColumnVisible('program') &&
          !isColumnVisible('group') &&
          !isColumnVisible('active') && (
            <Typography variant="body2" color="text.secondary">
              Choose a visible filterable column to add controls here.
            </Typography>
          )}
      </FilterBar>

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
                    indeterminate={selectedInView > 0 && selectedInView < pageImages.length}
                    checked={pageImages.length > 0 && selectedInView === pageImages.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </TableCell>
                {isColumnVisible('thumbnail') && <TableCell sx={{ width: 48, p: 0.5 }} />}
                {isColumnVisible('id') && (
                  <TableCell sortDirection={sortColumn === 'id' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'id'}
                      direction={sortColumn === 'id' ? sortDirection : 'asc'}
                      onClick={() => handleSort('id')}
                    >
                      ID
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('name') && (
                  <TableCell sortDirection={sortColumn === 'name' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'name'}
                      direction={sortColumn === 'name' ? sortDirection : 'asc'}
                      onClick={() => handleSort('name')}
                    >
                      Name
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('category') && (
                  <TableCell sortDirection={sortColumn === 'category' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'category'}
                      direction={sortColumn === 'category' ? sortDirection : 'asc'}
                      onClick={() => handleSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('copyright') && (
                  <TableCell sortDirection={sortColumn === 'copyright' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'copyright'}
                      direction={sortColumn === 'copyright' ? sortDirection : 'asc'}
                      onClick={() => handleSort('copyright')}
                    >
                      Copyright
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('note') && (
                  <TableCell sortDirection={sortColumn === 'note' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'note'}
                      direction={sortColumn === 'note' ? sortDirection : 'asc'}
                      onClick={() => handleSort('note')}
                    >
                      Note
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('program') && (
                  <TableCell sortDirection={sortColumn === 'program' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'program'}
                      direction={sortColumn === 'program' ? sortDirection : 'asc'}
                      onClick={() => handleSort('program')}
                    >
                      Program
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('group') && (
                  <TableCell sortDirection={sortColumn === 'group' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'group'}
                      direction={sortColumn === 'group' ? sortDirection : 'asc'}
                      onClick={() => handleSort('group')}
                    >
                      Groups
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('active') && (
                  <TableCell sortDirection={sortColumn === 'active' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'active'}
                      direction={sortColumn === 'active' ? sortDirection : 'asc'}
                      onClick={() => handleSort('active')}
                    >
                      Visibility
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('updated_at') && (
                  <TableCell sortDirection={sortColumn === 'updated_at' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'updated_at'}
                      direction={sortColumn === 'updated_at' ? sortDirection : 'asc'}
                      onClick={() => handleSort('updated_at')}
                    >
                      Modified
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('created_at') && (
                  <TableCell sortDirection={sortColumn === 'created_at' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'created_at'}
                      direction={sortColumn === 'created_at' ? sortDirection : 'asc'}
                      onClick={() => handleSort('created_at')}
                    >
                      Created
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('dimensions') && (
                  <TableCell sortDirection={sortColumn === 'dimensions' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'dimensions'}
                      direction={sortColumn === 'dimensions' ? sortDirection : 'asc'}
                      onClick={() => handleSort('dimensions')}
                    >
                      Dimensions
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('file_size') && (
                  <TableCell sortDirection={sortColumn === 'file_size' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'file_size'}
                      direction={sortColumn === 'file_size' ? sortDirection : 'asc'}
                      onClick={() => handleSort('file_size')}
                    >
                      File Size
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('measurement') && <TableCell>Measurement</TableCell>}
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedImages
                .slice(currentPage * rowsPerPage, currentPage * rowsPerPage + rowsPerPage)
                .map((img) => {
                  const categoryHidden = isImageCategoryHidden(img)
                  return (
                    <TableRow
                      key={img.id}
                      hover
                      selected={selected.has(img.id)}
                      {...((!img.active || categoryHidden) && { 'data-dimmed': true })}
                      sx={{
                        cursor: 'pointer',
                        '&[data-dimmed] .MuiTableCell-body:not([data-interactive])': {
                          color: visColors.inactive,
                        },
                        '&[data-dimmed] .MuiTableCell-body:not([data-interactive]) a, &[data-dimmed] .MuiTableCell-body:not([data-interactive]) .MuiLink-root':
                          { color: 'inherit' },
                      }}
                      onClick={() => handleRowClick(img)}
                    >
                      <TableCell
                        data-interactive="true"
                        padding="checkbox"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selected.has(img.id)}
                          onChange={(e) => handleSelectOne(img.id, e.target.checked)}
                        />
                      </TableCell>
                      {isColumnVisible('thumbnail') && (
                        <TableCell
                          data-interactive="true"
                          sx={{ p: 0.5 }}
                          onClick={(e) => {
                            if (onViewImage) {
                              e.stopPropagation()
                              onViewImage(img)
                            }
                          }}
                        >
                          <Box
                            component="img"
                            src={img.thumb}
                            alt={img.name}
                            sx={{
                              width: 40,
                              height: 40,
                              objectFit: 'cover',
                              borderRadius: 0.5,
                              display: 'block',
                              cursor: onViewImage ? 'pointer' : 'default',
                              ...(!img.active || categoryHidden
                                ? { filter: 'grayscale(100%)' }
                                : {}),
                            }}
                          />
                        </TableCell>
                      )}
                      {isColumnVisible('id') && <TableCell>{img.id}</TableCell>}
                      {isColumnVisible('name') && <TableCell>{img.name}</TableCell>}
                      {isColumnVisible('category') && (
                        <TableCell>
                          <CategoryBreadcrumb
                            categoryId={img.category_id}
                            categoryPaths={categoryPaths}
                            onNavigate={onNavigateCategory}
                            hiddenColor={visColors.inactive}
                          />
                        </TableCell>
                      )}
                      {isColumnVisible('copyright') && (
                        <TableCell>{img.copyright ?? '—'}</TableCell>
                      )}
                      {isColumnVisible('note') && (
                        <TableCell sx={{ maxWidth: 260, minWidth: 180 }}>
                          {img.note ? <NoteDisplay note={img.note} collapsedLines={2} /> : '—'}
                        </TableCell>
                      )}
                      {isColumnVisible('program') && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const { direct, ancestor } = getInheritedProgramIds(img)
                            if (direct.length === 0 && ancestor.length === 0) return 'All programs'
                            const chipClick = (name: string) => {
                              if (onSearchProgram) {
                                onSearchProgram(name)
                              } else {
                                handleFilterChange('program', name)
                              }
                            }
                            return (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {direct
                                  .map((pid) => programs.find((p) => p.id === pid))
                                  .filter((p): p is Program => p != null)
                                  .map((p) => (
                                    <Chip
                                      key={p.id}
                                      label={p.name}
                                      size="small"
                                      onClick={() => chipClick(p.name)}
                                      {...(img.active
                                        ? { color: 'primary', sx: { cursor: 'pointer' } }
                                        : {
                                            sx: {
                                              cursor: 'pointer',
                                              bgcolor: visColors.inactiveChipBg,
                                              color: '#fff',
                                            },
                                          })}
                                    />
                                  ))}
                                {ancestor
                                  .map((pid) => programs.find((p) => p.id === pid))
                                  .filter((p): p is Program => p != null)
                                  .map((p) => (
                                    <Chip
                                      key={p.id}
                                      label={p.name}
                                      size="small"
                                      onClick={() => chipClick(p.name)}
                                      {...(img.active
                                        ? {
                                            color: 'primary',
                                            sx: getInheritedRestrictionSx(true, {
                                              cursor: 'pointer',
                                            }),
                                          }
                                        : {
                                            sx: getInheritedRestrictionSx(true, {
                                              cursor: 'pointer',
                                              bgcolor: visColors.inactiveChipBg,
                                              color: '#fff',
                                            }),
                                          })}
                                    />
                                  ))}
                              </Box>
                            )
                          })()}
                        </TableCell>
                      )}
                      {isColumnVisible('group') && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const { direct, ancestor } = getInheritedGroupIds(img)
                            if (direct.length === 0 && ancestor.length === 0) return 'All groups'
                            const chipClick = (name: string) => {
                              handleFilterChange('group', name)
                            }
                            return (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {direct
                                  .map((gid) => groups.find((g) => g.id === gid))
                                  .filter((g): g is Group => g != null)
                                  .map((g) => (
                                    <Chip
                                      key={g.id}
                                      label={g.name}
                                      size="small"
                                      color="secondary"
                                      onClick={() => chipClick(g.name)}
                                      sx={{
                                        cursor: 'pointer',
                                        ...(img.active
                                          ? {}
                                          : {
                                              bgcolor: visColors.inactiveChipBg,
                                              color: '#fff',
                                            }),
                                      }}
                                    />
                                  ))}
                                {ancestor
                                  .map((gid) => groups.find((g) => g.id === gid))
                                  .filter((g): g is Group => g != null)
                                  .map((g) => (
                                    <Chip
                                      key={g.id}
                                      label={g.name}
                                      size="small"
                                      color="secondary"
                                      onClick={() => chipClick(g.name)}
                                      sx={
                                        img.active
                                          ? getInheritedRestrictionSx(true, { cursor: 'pointer' })
                                          : getInheritedRestrictionSx(true, {
                                              cursor: 'pointer',
                                              bgcolor: visColors.inactiveChipBg,
                                              color: '#fff',
                                            })
                                      }
                                    />
                                  ))}
                              </Box>
                            )
                          })()}
                        </TableCell>
                      )}
                      {isColumnVisible('active') && (
                        <TableCell data-interactive="true" onClick={(e) => e.stopPropagation()}>
                          <Tooltip
                            title={categoryHidden ? 'Hidden by category' : ''}
                            disableHoverListener={!categoryHidden}
                          >
                            <span>
                              <Switch
                                size="small"
                                checked={img.active}
                                onChange={() => {
                                  handleToggleActive(img).catch(() => {})
                                }}
                                disabled={categoryHidden}
                              />
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                      {isColumnVisible('updated_at') && (
                        <TableCell>{new Date(img.updated_at).toLocaleDateString()}</TableCell>
                      )}
                      {isColumnVisible('created_at') && (
                        <TableCell>{new Date(img.created_at).toLocaleDateString()}</TableCell>
                      )}
                      {isColumnVisible('dimensions') && (
                        <TableCell>
                          {img.width != null && img.height != null
                            ? `${img.width} × ${img.height}`
                            : '—'}
                        </TableCell>
                      )}
                      {isColumnVisible('file_size') && (
                        <TableCell>
                          {img.file_size != null ? formatFileSize(img.file_size) : '—'}
                        </TableCell>
                      )}
                      {isColumnVisible('measurement') && (
                        <TableCell>
                          {(() => {
                            const meta = img.metadata_extra
                            const scale = meta?.measurement_scale
                            const unit = meta?.measurement_unit
                            if (scale == null) return '—'
                            return unit ? `${scale} px/${unit}` : `${scale} px`
                          })()}
                        </TableCell>
                      )}
                      <TableCell
                        data-interactive="true"
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
                  )
                })}
            </TableBody>
          </Table>
          <TablePagination
            rowsPerPageOptions={[5, 10, 25, 50]}
            component="div"
            count={sortedImages.length}
            rowsPerPage={rowsPerPage}
            page={currentPage}
            onPageChange={(_, newPage) => setCurrentPage(newPage)}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setCurrentPage(0)
            }}
          />
        </TableContainer>
      )}

      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose image table columns"
        columns={MANAGE_COLUMN_OPTIONS}
        visibleColumns={visibleColumns}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={handleColumnVisibilityToggle}
      />

      {/* Action menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
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
        onDelete={
          editingImage
            ? async () => {
                await deleteImage(editingImage.id)
                setSelected((prev) => {
                  const next = new Set(prev)
                  next.delete(editingImage.id)
                  return next
                })
                setEditOpen(false)
                setEditingImage(null)
                await loadImages()
                onCategoriesChanged?.()
              }
            : undefined
        }
        onReplace={
          editingImage
            ? async ({ file, formData }: ReplaceImageData) => {
                const abort = new AbortController()
                replaceAbortRef.current = abort
                setReplaceProgress(0)
                try {
                  const result = await replaceImage(
                    editingImage.id,
                    file,
                    (fraction) => {
                      setReplaceProgress(fraction)
                    },
                    abort.signal,
                    formData,
                  )
                  onReplaceImage?.(result.id, file.name, file.size)
                  setEditOpen(false)
                  setEditingImage(null)
                  await loadImages()
                  onCategoriesChanged?.()
                } catch (err) {
                  if (err instanceof DOMException && err.name === 'AbortError') {
                    setEditOpen(false)
                    setEditingImage(null)
                    return
                  }
                  throw err
                } finally {
                  replaceAbortRef.current = null
                  setReplaceProgress(undefined)
                }
              }
            : undefined
        }
        onCancelReplace={() => replaceAbortRef.current?.abort()}
        replaceUploadProgress={replaceProgress}
        image={editingImage}
        categories={categories}
        programs={programs}
        groups={groups}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleVisibility}
        onViewImage={
          editingImage && onViewImage
            ? () => {
                const img = editingImage
                setEditOpen(false)
                setEditingImage(null)
                onViewImage(img)
              }
            : undefined
        }
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          loadImages()
          onCategoriesChanged?.()
        }}
        categories={categories}
        programs={programs}
        groups={groups}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleVisibility}
        onProcessingStarted={onProcessingStarted}
        onUploadStarted={onUploadStarted}
        onUploadProgress={onUploadProgress}
        onBulkImportStarted={onBulkImportStarted}
        onUploadFailed={onUploadFailed}
      />

      {/* Bulk edit images modal */}
      <BulkEditImagesModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkSave}
        onDelete={handleBulkDelete}
        categories={categories}
        selectedCount={selected.size}
        programs={programs}
        groups={groups}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleVisibility}
        allCategoryHidden={
          selected.size > 0 &&
          [...selected].every((id) => {
            const img = images.find((i) => i.id === id)
            return img != null && isImageCategoryHidden(img)
          })
        }
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          if (!deleting) handleCloseDeleteDialog()
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Image</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            You are about to delete <strong>{deleteDialogImage?.name}</strong>.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            To delete multiple images at once, select them and use the <strong>Bulk Edit</strong>{' '}
            option.
          </Typography>
          <Divider />
          <Box>
            <Button
              color="error"
              variant="contained"
              onClick={handleConfirmDeleteImage}
              disabled={deleting}
              fullWidth
            >
              Delete Image
            </Button>
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog} disabled={deleting}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

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
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleVisibility}
        programs={programs}
        groups={groups}
      />
    </Box>
  )
}
