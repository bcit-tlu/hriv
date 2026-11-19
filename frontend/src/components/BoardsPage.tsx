import Checkbox from '@mui/material/Checkbox'
import CollectionEditDialog from './CollectionEditDialog'
import type { CollectionFormValues } from './CollectionEditDialog'
import AddToCollectionDialog from './AddToCollectionDialog'
import {
  addSourcesToCollection,
  createCollectionFromSources,
  useEditableCollections,
} from '../useAddToCollection'
import { studentTypesAtCap } from '../collectionUtils'
import type { Category, CollectionType } from '../types'
import type { CollectionSources } from '../api'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isSubmitKey } from '../formKeys'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Snackbar,
  useMediaQuery,
  TextField,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import Room from '@mui/icons-material/Room'
import SelectAll from '@mui/icons-material/SelectAll'
import DragIndicator from '@mui/icons-material/DragIndicator'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import DriveFileMove from '@mui/icons-material/DriveFileMove'
import Block from '@mui/icons-material/Block'
import ViewModule from '@mui/icons-material/ViewModule'
import TableRows from '@mui/icons-material/TableRows'
import { CollectionVisibilityChip } from './CollectionCard'
import { graphToggleSx } from '../collectionsGraph/toggleStyles'
import Add from '@mui/icons-material/Add'
import Edit from '@mui/icons-material/Edit'
import Close from '@mui/icons-material/Close'
import SwapHoriz from '@mui/icons-material/SwapHoriz'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import VisibilityIcon from '@mui/icons-material/Visibility'
import DeleteIcon from '@mui/icons-material/Delete'
import ViewCarousel from '@mui/icons-material/ViewCarousel'
import ViewColumn from '@mui/icons-material/ViewColumn'
import ImageIcon from '@mui/icons-material/Image'
import { alpha, getContrastRatio, useTheme } from '@mui/material/styles'
import { markerAccentColor, markerFavouriteButtonSx } from '../theme'
import { formatRelativeTime } from '../formatUtils'
import FilterBar from './FilterBar'
import FilterPopoverButton, { filterSurfaceBg } from './FilterPopoverButton'
import FilterTextPanel from './FilterTextPanel'
import FilterOptionPanel from './FilterOptionPanel'
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useDraggable,
} from '@dnd-kit/react'
import type { DragEndEvent } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { CollisionPriority } from '@dnd-kit/abstract'
import {
  ApiError,
  deleteMarker,
  fetchBoard,
  fetchImages,
  fetchMarker,
  fetchMarkers,
  removeBoardMarker,
  reorderBoardMarkers,
  reorderBoards,
  reorderMarkers,
  updateBoard,
  updateMarker,
  userMessage,
} from '../api'
import { boardManagerText, moveBoardMember, ownsBoard } from '../boardUtils'
import { farHalfReorderCollision } from './sortableTileGridUtils'
import type { ApiImage } from '../api'
import type {
  ApiBoard,
  ApiBoardSummary,
  ApiMarker,
  BoardAssignment,
  Group,
  Program,
  User,
} from '../types'
import { useBoardsData } from '../useBoardsData'
import CategoryBreadcrumb, { buildCategoryPaths } from './CategoryBreadcrumb'
import BoardEditDialog from './BoardEditDialog'
import BoardOwnersDialog from './BoardOwnersDialog'
import MarkerFormDialog from './MarkerFormDialog'
import RenewingThumbnail from './RenewingThumbnail'
import BoardCoverPickerModal from './BoardCoverPickerModal'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import { ROWS_PER_PAGE_OPTIONS, useRowsPerPagePreference } from '../useRowsPerPagePreference'
import { resolveReorderedKeys } from './columnVisibilityUtils'

interface BoardsPageProps {
  collectionsEnabled?: boolean
  categories?: Category[]
  onOpenCollection?: (id: number) => void
  enabled: boolean
  currentUser: User | null
  programs?: Program[]
  groups?: Group[]
  boardId: number | null
  onSelectBoard: (boardId: number | null) => void
  onOpenMarker: (item: ApiMarker) => void
  onNavigateCategory?: (categoryPath: Category[]) => void
}

type MarkerTableColumn =
  | 'thumbnail'
  | 'title'
  | 'image'
  | 'description'
  | 'category'
  | 'boards'
  | 'favourite'
  | 'owner'
  | 'created'
  | 'updated'

const MARKER_TABLE_COLUMN_OPTIONS: readonly ColumnVisibilityOption<MarkerTableColumn>[] = [
  { key: 'thumbnail', label: 'Thumbnail' },
  { key: 'title', label: 'Title' },
  { key: 'image', label: 'Image' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'boards', label: 'Boards' },
  { key: 'favourite', label: 'Favourite' },
  { key: 'owner', label: 'Owner' },
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Modified' },
]

type SortableMarkerColumn = Exclude<MarkerTableColumn, 'thumbnail' | 'boards'>
const MARKER_TABLE_ALL_COLUMNS = MARKER_TABLE_COLUMN_OPTIONS.map((option) => option.key)

/** Marker accent — muted blue in light mode, brighter blue in dark — shared by
    Marker titles/pins and the thick Board tile border. */

type SortableFrameProps = {
  id: string
  index: number
  type: string
  group: string
  disabled: boolean
  label: string
  children: ReactNode
  sortable?: boolean
  hideHandle?: boolean
}

function SortableFrame(props: SortableFrameProps) {
  return props.sortable === false ? (
    <DraggableFrame {...props} />
  ) : (
    <ActiveSortableFrame {...props} />
  )
}

function DraggableFrame({ id, children, disabled, label }: SortableFrameProps) {
  const { ref, handleRef, isDragSource } = useDraggable({ id, type: 'board-member', disabled })
  return (
    <Box
      role="group"
      aria-label={label}
      ref={(node: HTMLDivElement | null) => {
        ref(node)
        handleRef(node)
      }}
      sx={{
        position: 'relative',
        minWidth: 0,
        opacity: isDragSource ? 0.5 : 1,
        outline: isDragSource ? '3px solid' : undefined,
        outlineColor: 'primary.main',
      }}
    >
      {children}
    </Box>
  )
}

function ActiveSortableFrame({
  id,
  index,
  type,
  group,
  disabled,
  label,
  children,
  hideHandle,
}: SortableFrameProps) {
  const { ref, handleRef, isDragSource } = useSortable({
    id,
    index,
    type,
    accept: type,
    group,
    disabled,
    collisionDetector: farHalfReorderCollision,
  })
  return (
    <Box
      role={hideHandle ? 'group' : undefined}
      aria-label={hideHandle ? label : undefined}
      ref={(node: HTMLDivElement | null) => {
        ref(node)
        if (hideHandle) handleRef(node)
      }}
      sx={{
        position: 'relative',
        opacity: isDragSource ? 0.5 : 1,
        outline: isDragSource ? '3px solid' : undefined,
        outlineColor: 'primary.main',
        minWidth: 0,
        ...(type === 'board-card' && { flex: '0 0 auto', width: 260 }),
      }}
    >
      {!hideHandle && (
        <IconButton
          ref={handleRef}
          aria-label={`Reorder ${label}`}
          size="small"
          disabled={disabled}
          sx={{
            position: 'absolute',
            top: 5,
            right: 5,
            zIndex: 2,
            touchAction: 'none',
            cursor: 'grab',
            display: disabled ? 'none' : undefined,
          }}
        >
          <DragIndicator fontSize="small" />
        </IconButton>
      )}
      {children}
    </Box>
  )
}

function DropArea({
  id,
  label,
  enabled,
  blocked,
  children,
}: {
  id: string
  label: string
  enabled: boolean
  blocked?: boolean
  children: ReactNode
}) {
  const { ref, isDropTarget } = useDroppable({
    id,
    type: 'board-member-bin',
    accept: 'board-member',
    collisionPriority: CollisionPriority.High,
  })
  const active = enabled && isDropTarget
  const denied = blocked === true && isDropTarget
  return (
    <Box
      ref={ref}
      role="region"
      aria-label={label}
      sx={{
        borderRadius: 2,
        position: 'relative',
        // The dragged tile follows the pointer and can cover this region;
        // raising the highlighted drop zone keeps its overlay readable.
        zIndex: active || denied ? 1 : 0,
        outline: '3px dashed',
        outlineColor: active ? 'primary.main' : denied ? 'text.disabled' : 'transparent',
        outlineOffset: 3,
        transform: active ? 'scale(1.03)' : 'scale(1)',
        transition: 'outline-color 0.2s, transform 0.15s',
        minHeight: 0,
      }}
    >
      {children}
      {(active || denied) && (
        // Opaque overlay like the Category/Image drop zones (#1567): an
        // "Add here" placeholder swaps the tile face while hovering; a
        // muted "Already saved" placeholder marks memberships instead.
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
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
              bgcolor: active ? 'primary.main' : 'action.disabled',
              color: active ? 'primary.contrastText' : 'background.paper',
            }}
          >
            {active ? <DriveFileMove sx={{ fontSize: 24 }} /> : <Block sx={{ fontSize: 24 }} />}
          </Box>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, color: active ? 'primary.main' : 'text.disabled' }}
          >
            {active ? 'Add here' : 'Already saved'}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

type NoticeUndo =
  | { kind: 'assignments'; markerId: number; version: number; assignments: BoardAssignment[] }
  | { kind: 'boards'; items: { board_id: number; version: number }[] }
  | { kind: 'markers'; items: { marker_id: number; version: number }[] }
  | { kind: 'members'; boardId: number; version: number; ids: number[] }

/** Pairs the pre-reorder ids with the versions the reorder returned; `null`
 *  (no Undo offered) when the response doesn't cover every id. */
function undoItems<T>(
  previous: number[],
  saved: { id: number; version: number }[],
  item: (id: number, version: number) => T,
): T[] | null {
  const versions = new Map(saved.map((row) => [row.id, row.version]))
  if (previous.some((id) => !versions.has(id))) return null
  return previous.map((id) => item(id, versions.get(id)!))
}

function BoardCover({ board }: { board: ApiBoardSummary }) {
  const [state, setState] = useState<{ id: number; items: ApiMarker[] } | null>(null)
  const key = `${board.id}:${board.version}`
  useEffect(() => {
    // An explicit "no cover" pick renders the placeholder — no member
    // fetch needed.
    if (board.cover_blank) return
    let active = true
    void fetchMarkers({ board_id: board.id, limit: 4 }).then(
      (items) => {
        if (active) setState({ id: board.id, items })
      },
      () => {
        if (active)
          setState((previous) =>
            previous?.id === board.id ? previous : { id: board.id, items: [] },
          )
      },
    )
    return () => {
      active = false
    }
  }, [board.id, board.cover_blank, key])
  const item =
    !board.cover_blank && state?.id === board.id
      ? state.items.find((item) => item.thumb != null)
      : undefined
  return (
    <Box
      sx={{
        width: 70,
        height: 70,
        flexShrink: 0,
        bgcolor: 'action.hover',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {board.cover_thumb && !board.cover_blank ? (
        <RenewingThumbnail
          image={{ id: board.id, thumb: board.cover_thumb }}
          renewThumb={async (id) => {
            const fresh = await fetchBoard(id)
            return { id, thumb: fresh.cover_thumb }
          }}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : item ? (
        <RenewingThumbnail
          image={{ id: item.id, thumb: item.thumb ?? '' }}
          renewThumb={fetchMarker}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <SpaceDashboardOutlined sx={{ fontSize: 32, color: 'text.secondary' }} />
      )}
    </Box>
  )
}

/** Returns the Undo that restores the editable assignments held before the
 *  save, pinned to the version the save returned. */
async function saveToBoard(
  item: ApiMarker,
  targetId: number,
  sourceId: number | null,
): Promise<NoticeUndo> {
  const fresh = await fetchMarker(item.id)
  const boards = await Promise.all(fresh.board_ids.map((fetchBoardId) => fetchBoard(fetchBoardId)))
  const previous: BoardAssignment[] = []
  const assignments: BoardAssignment[] = []
  for (const board of boards) {
    if (!board.permissions.can_edit) continue
    const link = board.markers.find((member) => member.id === fresh.id)
    if (!link) throw new Error('Board membership changed. Reload before saving.')
    const assignment = { board_id: board.id, sort_order: link.sort_order }
    previous.push(assignment)
    if (board.id !== sourceId && board.id !== targetId) assignments.push(assignment)
  }
  assignments.push({ board_id: targetId })
  const saved = await updateMarker(fresh.id, {
    version: fresh.version,
    board_assignments: assignments,
  })
  return { kind: 'assignments', markerId: saved.id, version: saved.version, assignments: previous }
}

function SaveToDialog({
  item,
  boards,
  source,
  onClose,
  onSave,
  error,
  busy,
  conflict,
  onReload,
}: {
  item: ApiMarker
  boards: ApiBoardSummary[]
  source: ApiBoard | null
  onClose: () => void
  onSave: (targetId: number, move: boolean) => void
  error: string | null
  busy: boolean
  conflict: boolean
  onReload: () => void
}) {
  const options = boards.filter(
    (board) => board.permissions.can_edit && !item.board_ids.includes(board.id),
  )
  const [targetId, setTargetId] = useState(options[0]?.id ?? 0)
  const [target, setTarget] = useState<ApiBoard | null>(null)
  const [move, setMove] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    if (targetId)
      void fetchBoard(targetId).then(
        (board) => {
          if (active) {
            setTarget(board)
            setLoadError(null)
          }
        },
        (err) => {
          if (active) setLoadError(userMessage(err, 'Unable to load destination.'))
        },
      )
    return () => {
      active = false
    }
  }, [targetId, retry])
  const ready = target?.id === targetId && !loadError
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save “{item.title}” to…</DialogTitle>
      <DialogContent
        // Capture phase: the Destination Select consumes Enter (opening its
        // menu) before a bubbling handler sees it; plain Enter still opens it.
        onKeyDownCapture={(event) => {
          if (!(event.ctrlKey || event.metaKey) || !isSubmitKey(event)) return
          if (busy || conflict || !ready || !options.length) return
          event.preventDefault()
          event.stopPropagation()
          onSave(targetId, move)
        }}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          {(error || loadError) && (
            <Alert
              severity="error"
              action={
                conflict ? (
                  <Button size="small" onClick={onReload}>
                    Reload latest
                  </Button>
                ) : loadError ? (
                  <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                    Retry
                  </Button>
                ) : undefined
              }
            >
              {error || loadError}
            </Alert>
          )}
          {!options.length ? (
            <Alert severity="info">No other editable Boards. Create a Board first.</Alert>
          ) : (
            <>
              <TextField
                select
                label="Destination Board"
                value={targetId}
                onChange={(e) => {
                  setTargetId(Number(e.target.value))
                }}
                disabled={busy}
              >
                {options.map((board) => (
                  <MenuItem key={board.id} value={board.id}>
                    {board.name}
                  </MenuItem>
                ))}
              </TextField>
              {source?.permissions.can_edit && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={move}
                      onChange={(e) => setMove(e.target.checked)}
                      disabled={busy}
                    />
                  }
                  label="Move: also remove from this Board"
                />
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || conflict || !ready || !options.length}
          onClick={() => onSave(targetId, move)}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BoardsPage({
  enabled,
  collectionsEnabled = true,
  categories = [],
  onOpenCollection,
  currentUser,
  programs = [],
  groups = [],
  boardId,
  onSelectBoard,
  onOpenMarker,
  onNavigateCategory,
}: BoardsPageProps) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [sortColumn, setSortColumn] = useState<SortableMarkerColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [rowsPerPage, setRowsPerPage] = useRowsPerPagePreference('board-markers')
  const [currentPage, setCurrentPage] = useState(0)
  const [images, setImages] = useState<Record<number, ApiImage>>({})
  useEffect(() => {
    // Tile captions and the Image/Category table columns resolve markers'
    // image_id through this map — load it in both views.
    let active = true
    void fetchImages().then(
      (items) => {
        if (active) setImages(Object.fromEntries(items.map((img) => [img.id, img])))
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [])
  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])
  // Marker Table columns — per-user persisted visibility + order, the same
  // hook/storage convention as the Manage/People/Collections tables (#1577).
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const {
    visibleColumns: markerColumns,
    toggleColumn: toggleMarkerColumn,
    columnOrder: markerColumnOrder,
    orderedVisibleColumns: orderedMarkerColumns,
    setColumnOrder: setMarkerColumnOrder,
  } = useTableColumnPreferences<MarkerTableColumn>({
    tableKey: 'markers',
    allColumns: MARKER_TABLE_ALL_COLUMNS,
    defaultVisibleColumns: MARKER_TABLE_ALL_COLUMNS,
  })
  const orderedMarkerColumnOptions = useMemo(() => {
    const byKey = new Map(MARKER_TABLE_COLUMN_OPTIONS.map((option) => [option.key, option]))
    return markerColumnOrder
      .map((key) => byKey.get(key))
      .filter((option): option is ColumnVisibilityOption<MarkerTableColumn> => option != null)
  }, [markerColumnOrder])
  const markerSortValue = (item: ApiMarker, column: SortableMarkerColumn) => {
    switch (column) {
      case 'title':
        return item.title.toLocaleLowerCase()
      case 'image':
        return (images[item.image_id]?.name ?? '').toLocaleLowerCase()
      case 'description':
        return (item.description ?? '').toLocaleLowerCase()
      case 'category':
        return (item.category_name ?? '').toLocaleLowerCase()
      case 'favourite':
        return Number(item.favourite)
      case 'owner':
        return item.owners
          .map((entry) => entry.name)
          .join(', ')
          .toLocaleLowerCase()
      case 'created':
        return item.created_at
      case 'updated':
        return item.updated_at
    }
  }
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<{ boardId: number | null; ids: number[] }>({
    boardId,
    ids: [],
  })
  const selectedIds = selection.boardId === boardId ? selection.ids : []
  const [collectionSource, setCollectionSource] = useState<{
    sources: CollectionSources
    items: ApiMarker[]
    type: CollectionType
    add: boolean
  } | null>(null)
  const editableCollections = useEditableCollections(
    enabled && collectionsEnabled && collectionSource != null,
  )
  const beginCollection = (
    items: ApiMarker[],
    type: CollectionType,
    add = false,
    sources: CollectionSources = { marker_ids: items.map((item) => item.id) },
  ) => {
    setError(null)
    setCollectionSource({ items, type, add, sources })
  }
  const createSeededCollection = async (values: CollectionFormValues) => {
    if (!collectionSource) return
    const created = await createCollectionFromSources(values, collectionSource.sources)
    setCollectionSource(null)
    onOpenCollection?.(created.id)
  }
  const toggleSelected = (id: number) =>
    setSelection((prev) => {
      const ids = prev.boardId === boardId ? prev.ids : []
      return { boardId, ids: ids.includes(id) ? ids.filter((key) => key !== id) : [...ids, id] }
    })
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [query, setQuery] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [owner, setOwner] = useState('any')
  const [discovery, setDiscovery] = useState<'all' | null>(null)
  const [discoveryFilters, setDiscoveryFilters] = useState<('shared' | 'instructor')[]>([])
  const [notice, setNotice] = useState<{
    message: string
    severity: 'success' | 'info' | 'warning'
    undo?: NoticeUndo
  } | null>(null)
  const notify = (
    message: string,
    severity: 'success' | 'info' | 'warning' = 'warning',
    undo?: NoticeUndo,
  ) => setNotice({ message, severity, undo })
  const [favourites, setFavourites] = useState(false)
  const data = useBoardsData(boardId, favourites, enabled)
  const board = data.board
  // Seed the open-Board chrome from the overview summary — the dialog's
  // title, count, scope and description render instantly while the full
  // Board (its markers) is fetched, so the dialog never pops in empty.
  const boardSummary =
    board ?? (boardId != null ? data.boards.find((row) => row.id === boardId) : undefined) ?? null
  const [edit, setEdit] = useState<'new' | 'edit' | null>(null)
  const [owners, setOwners] = useState(false)
  const [savingItem, setSavingItem] = useState<ApiMarker | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuItem, setMenuItem] = useState<ApiMarker | null>(null)
  const [deletingItem, setDeletingItem] = useState<ApiMarker | null>(null)
  const [removingItem, setRemovingItem] = useState<ApiMarker | null>(null)
  const [editingItem, setEditingItem] = useState<ApiMarker | null>(null)
  const [coverPicker, setCoverPicker] = useState<ApiBoardSummary | null>(null)
  const [coverPickerMarkers, setCoverPickerMarkers] = useState<ApiMarker[]>([])
  const [activeItem, setActiveItem] = useState<ApiMarker | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const activeBoardId = useRef(boardId)
  useLayoutEffect(() => {
    activeBoardId.current = boardId
  }, [boardId])
  const [appliedBoardId, setAppliedBoardId] = useState(boardId)
  if (appliedBoardId !== boardId) {
    setAppliedBoardId(boardId)
    setEdit(null)
    setOwners(false)
    setSavingItem(null)
    setRemovingItem(null)
    setEditingItem(null)
    setBusy(false)
    setError(null)
    setConflict(false)
  }
  const own = data.boards.filter((row) => ownsBoard(row, currentUser))
  const isSharedBoard = (row: ApiBoardSummary) =>
    (!ownsBoard(row, currentUser) || !row.permissions.can_edit) &&
    (row.visibility !== 'private' || ownsBoard(row, currentUser))
  const isInstructorBoard = (row: ApiBoardSummary) =>
    row.owner_program_id != null ||
    row.owners.some((owner) => owner.role === 'admin' || owner.role === 'instructor')
  const canBrowseAllBoards =
    currentUser != null && ['admin', 'instructor', 'staff'].includes(currentUser.role)
  const discoveryBoards = data.boards.filter(
    (row) =>
      discoveryFilters.length === 0 ||
      discoveryFilters.some((filter) =>
        filter === 'shared' ? isSharedBoard(row) : isInstructorBoard(row),
      ),
  )
  const reorderableBoards = own.filter((row) => row.permissions.can_edit)
  const needle = query.trim().toLocaleLowerCase()
  const ownerMatches = (item: ApiBoardSummary | ApiMarker) =>
    owner === 'any' ||
    (owner === 'mine'
      ? 'owner_program_id' in item
        ? ownsBoard(item, currentUser)
        : item.owners.some((o) => o.user_id === currentUser?.id)
      : item.owners.some(
          (o) => `user:${o.user_id}` === owner || `program:${o.program_id}` === owner,
        ))
  const scopeIds = new Set(
    data.boards
      .filter((row) => !scopes.length || scopes.includes(row.visibility))
      .map((row) => row.id),
  )
  const filteredItems = data.recent.filter(
    (item) =>
      item.owners.some((o) => o.user_id === currentUser?.id) &&
      (!needle || `${item.title} ${item.description ?? ''}`.toLocaleLowerCase().includes(needle)) &&
      (!scopes.length || item.board_ids.some((id) => scopeIds.has(id))) &&
      ownerMatches(item) &&
      (!favourites || item.favourite),
  )
  const rows = reorderableBoards.filter(
    (row) =>
      (!needle || `${row.name} ${row.description ?? ''}`.toLocaleLowerCase().includes(needle)) &&
      scopeIds.has(row.id) &&
      ownerMatches(row) &&
      (!favourites ||
        data.recent.some((item) => item.favourite && item.board_ids.includes(row.id))),
  )
  const ownerOptions = Array.from(
    new Map(
      [...data.boards, ...data.recent]
        .flatMap((row) => row.owners)
        .map((o) => [o.user_id != null ? `user:${o.user_id}` : `program:${o.program_id}`, o.name]),
    ).entries(),
  ).map(([value, label]) => ({ value, label }))
  const filtered = !!needle || scopes.length > 0 || owner !== 'any' || favourites
  const selectionScope = `${boardId}:${query}:${scopes.join(',')}:${owner}:${favourites}`
  const [appliedSelectionScope, setAppliedSelectionScope] = useState(selectionScope)
  if (selectionScope !== appliedSelectionScope) {
    setAppliedSelectionScope(selectionScope)
    setSelecting(false)
    setSelection({ boardId, ids: [] })
  }
  const canEdit = !!board?.permissions.can_edit
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: (event: PointerEvent) =>
          event.pointerType === 'touch'
            ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
            : [new PointerActivationConstraints.Distance({ value: 8 })],
      }),
      KeyboardSensor,
    ],
    [],
  )
  const reload = async () => {
    await data.reload()
    setConflict(false)
    setError(null)
  }
  const openCoverPicker = (row: ApiBoardSummary) => {
    // Load the member list first so the modal opens fully formed —
    // summaries carry no markers; the detail's array is member-ordered.
    void fetchBoard(row.id).then(
      (board) => {
        setCoverPickerMarkers(board.markers)
        setCoverPicker(row)
      },
      (err) => setError(userMessage(err, 'Unable to load the Board Markers.')),
    )
  }
  const saveCover = async (markerId: number | null, blank: boolean) => {
    const row = coverPicker
    if (!row) return
    setBusy(true)
    try {
      await updateBoard(row.id, {
        version: row.version,
        cover_marker_id: markerId,
        cover_blank: blank,
      })
      await data.reload()
      setCoverPicker(null)
    } catch (err) {
      setError(userMessage(err, 'Unable to update the Board cover.'))
    } finally {
      setBusy(false)
    }
  }
  // Undo replays the prior order with the versions the reorder itself
  // returned, so a newer edit by anyone else (even after a reload) turns
  // the Undo into a 409 instead of being silently overwritten.
  const undoNotice = (undo: NoticeUndo) => {
    const job =
      undo.kind === 'assignments'
        ? () =>
            updateMarker(undo.markerId, {
              version: undo.version,
              board_assignments: undo.assignments,
            })
        : undo.kind === 'boards'
          ? () => reorderBoards(undo.items)
          : undo.kind === 'markers'
            ? () => reorderMarkers(undo.items)
            : () =>
                reorderBoardMarkers(undo.boardId, {
                  version: undo.version,
                  items: undo.ids.map((marker_id) => ({ marker_id })),
                })
    void run(job).then((ok) => {
      if (ok) setNotice(null)
    })
  }
  const run = async (job: () => Promise<unknown>) => {
    if (busy || conflict) return false
    setBusy(true)
    setError(null)
    try {
      await job()
      if (activeBoardId.current !== boardId) return false
      await data.reload()
      return true
    } catch (err) {
      if (activeBoardId.current !== boardId) return false
      const stale = err instanceof ApiError && err.status === 409
      setConflict(stale)
      setError(
        stale
          ? 'This Board or Marker changed. Reload the latest version before continuing.'
          : userMessage(err, 'Unable to save changes.'),
      )
      return false
    } finally {
      if (activeBoardId.current === boardId) setBusy(false)
    }
  }
  const dragEnd = (event: DragEndEvent) => {
    const { source, target } = event.operation
    setActiveItem(null)
    if (event.canceled || !source) return
    if (busy || conflict) {
      if (source.type === 'board-member' && target)
        notify(
          conflict
            ? 'Reload latest changes before dropping Markers.'
            : 'Wait for the current change to finish.',
        )
      return
    }
    if (source.type === 'board-card' && !filtered) {
      const ids = resolveReorderedKeys(
        reorderableBoards.map((row) => `board:${row.id}`),
        event,
      )
      if (ids) {
        const previous = reorderableBoards.map((row) => row.id)
        let undo: NoticeUndo | undefined
        void run(async () => {
          const saved = await reorderBoards(
            ids.flatMap((id) => {
              const row = reorderableBoards.find((candidate) => `board:${candidate.id}` === id)
              return row ? [{ board_id: row.id, version: row.version }] : []
            }),
          )
          const items = undoItems(previous, saved, (board_id, version) => ({ board_id, version }))
          if (items) undo = { kind: 'boards', items }
        }).then((ok) => {
          if (ok) notify('Order saved', 'success', undo)
        })
      }
    } else if (source.type === 'board-member') {
      const item = (board?.markers ?? data.recent).find((row) => `item:${row.id}` === source.id)
      if (!item) {
        notify('This Marker is no longer available. Reload before saving.')
        return
      }
      const key = target ? String(target.id) : ''
      if (key.startsWith('save:')) {
        const destination = data.boards.find((row) => row.id === Number(key.split(':')[1]))
        if (!destination) {
          notify('This Board is no longer available. Reload before saving.')
          return
        }
        if (!destination.permissions.can_edit) {
          notify(`You can't add Markers to ${destination.name}`)
          return
        }
        if (item.board_ids.includes(destination.id)) {
          notify(`Already in ${destination.name}`, 'info')
          return
        }
        if (!item.permissions.can_edit) {
          notify(`You can't add this Marker to ${destination.name}`)
          return
        }
        let undo: NoticeUndo | undefined
        void run(async () => {
          undo = await saveToBoard(item, destination.id, null)
        }).then((ok) => {
          if (ok) notify(`Saved to ${destination.name}`, 'success', undo)
        })
      } else if (!board && !filtered) {
        const ids = resolveReorderedKeys(
          filteredItems.map((row) => `item:${row.id}`),
          event,
        )
        if (ids) {
          const previous = filteredItems.map((row) => row.id)
          let undo: NoticeUndo | undefined
          void run(async () => {
            const saved = await reorderMarkers(
              ids.flatMap((id) => {
                const row = filteredItems.find((candidate) => `item:${candidate.id}` === id)
                return row ? [{ marker_id: row.id, version: row.version }] : []
              }),
            )
            const items = undoItems(previous, saved, (marker_id, version) => ({
              marker_id,
              version,
            }))
            if (items) undo = { kind: 'markers', items }
          }).then((ok) => {
            if (ok) notify('Order saved', 'success', undo)
          })
        }
      } else if (board && canEdit) {
        const targetItem = target
          ? board.markers.find((row) => `item:${row.id}` === target.id)
          : undefined
        if (target && !targetItem) {
          notify('This drop target is no longer available. Reload before reordering.')
          return
        }
        const index = isSortable(source)
          ? source.index
          : targetItem
            ? board.markers.indexOf(targetItem)
            : undefined
        if (index === undefined) return
        const previous = board.markers.map((row) => row.id)
        let undo: NoticeUndo | undefined
        void run(async () => {
          const saved = await reorderBoardMarkers(board.id, {
            version: board.version,
            items: moveBoardMember(board, item.id, index),
          })
          undo = { kind: 'members', boardId: saved.id, version: saved.version, ids: previous }
        }).then((ok) => {
          if (ok) notify('Order saved', 'success', undo)
        })
      } else if (board) {
        notify(`You can't reorder Markers in ${board.name}`)
      }
    }
  }
  const itemBoards = (item: ApiMarker) =>
    data.boards.filter((row) => item.board_ids.includes(row.id))
  const favouriteAction = (item: ApiMarker) => {
    if (!item.permissions.can_edit)
      return item.favourite ? (
        <Box
          component="span"
          role="img"
          aria-label={`Favourite ${item.title}`}
          sx={{ display: 'inline-flex', p: 0.5, borderRadius: '50%', bgcolor: 'primary.main' }}
        >
          <Star sx={{ color: 'common.white' }} fontSize="small" />
        </Box>
      ) : null
    return (
      <Tooltip title="Favourite">
        <IconButton
          size="small"
          aria-label={`Favourite ${item.title}`}
          aria-pressed={item.favourite}
          // data-favourite-star exempts this button from the overlay
          // cluster's uniform grey-disc rule — the star carries its own
          // shared face (blue disc on / grey disc off).
          data-favourite-star
          sx={markerFavouriteButtonSx(item.favourite)}
          disabled={conflict}
          onClick={() =>
            void run(() =>
              updateMarker(item.id, { version: item.version, favourite: !item.favourite }),
            )
          }
        >
          {item.favourite ? (
            <Star sx={{ color: 'common.white' }} fontSize="small" />
          ) : (
            <StarBorder sx={{ color: 'common.white' }} fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
    )
  }
  const editAction = (item: ApiMarker) =>
    (item.permissions.can_edit || board?.permissions.can_edit) && (
      <Tooltip title="Edit Marker">
        <IconButton
          size="small"
          aria-label={`Edit Marker: ${item.title}`}
          disabled={conflict}
          onClick={() => {
            if (busy) return
            setError(null)
            setEditingItem(item)
          }}
        >
          <Edit fontSize="small" />
        </IconButton>
      </Tooltip>
    )
  const moveAction = (item: ApiMarker) =>
    item.permissions.can_edit && (
      <Tooltip title="Move/Save to Board">
        <IconButton
          size="small"
          aria-label={`Move/Save ${item.title} to Board`}
          disabled={conflict}
          onClick={() => {
            if (busy) return
            setError(null)
            setSavingItem(item)
          }}
        >
          <DriveFileMove fontSize="small" />
        </IconButton>
      </Tooltip>
    )
  const memberCard = (item: ApiMarker, index: number, inBoard = false) => (
    <SortableFrame
      key={item.id}
      id={`${!inBoard && boardId != null ? 'backdrop' : 'item'}:${item.id}`}
      index={index}
      type="board-member"
      group="members"
      hideHandle
      disabled={selecting || busy || conflict || (inBoard ? !canEdit : !item.permissions.can_edit)}
      sortable={inBoard || !filtered}
      label={item.title}
    >
      <Card
        elevation={2}
        data-testid="marker-card"
        sx={{
          position: 'relative',
          height: '100%',
          outline: selecting && selectedIds.includes(item.id) ? '3px solid' : 'none',
          outlineColor: markerAccentColor,
        }}
      >
        {/* Whole-face action area like ImageTile/CollectionCard: hovering
            anywhere on the tile lights the entire card, not just the
            thumbnail strip. */}
        <CardActionArea
          component="div"
          role="button"
          tabIndex={0}
          onClick={() => (selecting ? toggleSelected(item.id) : onOpenMarker(item))}
          aria-label={selecting ? `Select ${item.title}` : `Open Marker: ${item.title}`}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            alignItems: 'stretch',
          }}
        >
          {item.thumb ? (
            <RenewingThumbnail
              image={{ id: item.id, thumb: item.thumb }}
              renewThumb={fetchMarker}
              alt=""
              sx={{ width: '100%', height: 96, display: 'block', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                height: 96,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <Room sx={{ fontSize: 48 }} />
            </Box>
          )}
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="flex-start" gap={0.5}>
              <Room sx={{ fontSize: 24, flexShrink: 0, color: markerAccentColor }} />
              <Typography
                component="h2"
                variant="h6"
                title={item.title}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  color: markerAccentColor,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                }}
              >
                {item.title}
              </Typography>
            </Stack>
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              title={images[item.image_id]?.name ?? `Image ${item.image_id}`}
            >
              {images[item.image_id]?.name ?? `Image ${item.image_id}`}
            </Typography>
          </CardContent>
        </CardActionArea>
        {selecting && (
          // Top-left select indicator like the Collection Manage Images
          // tiles (#1567): an opaque white fill inside the outline so it
          // reads over any thumbnail, checked flips the fill.
          <Checkbox
            size="small"
            checked={selectedIds.includes(item.id)}
            onChange={() => toggleSelected(item.id)}
            inputProps={{ 'aria-label': `Select ${item.title}` }}
            sx={(theme) => ({
              position: 'absolute',
              top: 6,
              left: 6,
              zIndex: 1,
              p: 0.5,
              borderRadius: '50%',
              color: 'grey.700',
              bgcolor: alpha(theme.palette.common.white, 0.92),
              boxShadow: theme.shadows[2],
              '&:hover': { bgcolor: theme.palette.common.white },
              '&.Mui-checked': { color: markerAccentColor(theme) },
            })}
          />
        )}
        <Box
          sx={(theme) => ({
            position: 'absolute',
            top: 4,
            right: 4,
            display: 'flex',
            gap: 0.5,
            '& .MuiIconButton-root:not([data-favourite-star])': {
              color: theme.palette.common.white,
              bgcolor: alpha(theme.palette.common.black, 0.25),
              '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.45) },
            },
          })}
        >
          {favouriteAction(item)}
          {moveAction(item)}
          {editAction(item)}
        </Box>
      </Card>
    </SortableFrame>
  )
  const handleMarkerSort = (column: SortableMarkerColumn) => {
    if (sortColumn === column) setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    else {
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(0)
  }
  const markerSortHeader = (column: MarkerTableColumn, label: string) =>
    column === 'thumbnail' ? (
      <TableCell align="center">{label}</TableCell>
    ) : column === 'boards' ? (
      <TableCell>{label}</TableCell>
    ) : (
      <TableCell sortDirection={sortColumn === column ? sortDirection : false}>
        <TableSortLabel
          active={sortColumn === column}
          direction={sortColumn === column ? sortDirection : 'asc'}
          onClick={() => handleMarkerSort(column)}
        >
          {label}
        </TableSortLabel>
      </TableCell>
    )
  const memberTable = (items: ApiMarker[]) => {
    const sorted =
      sortColumn == null
        ? items
        : [...items].sort((a, b) => {
            const av = markerSortValue(a, sortColumn)
            const bv = markerSortValue(b, sortColumn)
            const cmp =
              typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv))
            return (sortDirection === 'asc' ? cmp : -cmp) || a.id - b.id
          })
    const maxPage = Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1)
    if (currentPage > maxPage) setCurrentPage(maxPage)
    const pageItems = sorted.slice(
      currentPage * rowsPerPage,
      currentPage * rowsPerPage + rowsPerPage,
    )
    const allSelected =
      pageItems.length > 0 && pageItems.every((item) => selectedIds.includes(item.id))
    const togglePageSelected = (checked: boolean) =>
      setSelection((prev) => {
        const ids = new Set(prev.boardId === boardId ? prev.ids : [])
        pageItems.forEach((item) => (checked ? ids.add(item.id) : ids.delete(item.id)))
        return { boardId, ids: [...ids] }
      })
    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Markers">
          <TableHead
            sx={{
              '& .MuiTableCell-head': {
                bgcolor: (theme) => filterSurfaceBg(theme),
                fontWeight: 600,
              },
            }}
          >
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  inputProps={{ 'aria-label': 'Select all Markers on this page' }}
                  checked={allSelected}
                  indeterminate={
                    !allSelected && pageItems.some((item) => selectedIds.includes(item.id))
                  }
                  onChange={(event) => togglePageSelected(event.target.checked)}
                />
              </TableCell>
              {orderedMarkerColumns.map((column) => (
                <Fragment key={column}>
                  {markerSortHeader(
                    column,
                    MARKER_TABLE_COLUMN_OPTIONS.find((option) => option.key === column)?.label ??
                      column,
                  )}
                </Fragment>
              ))}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageItems.map((item) => {
              // Per-column cells keyed like the header row — rendered in the
              // user's persisted column order (#1577). Actions stays a fixed
              // trailing column like the other tables.
              const cells: Record<MarkerTableColumn, ReactNode> = {
                thumbnail: (
                  <TableCell
                    align="center"
                    sx={{ width: 48, p: 0.5 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconButton
                      size="small"
                      aria-label={`View Marker: ${item.title}`}
                      onClick={() => onOpenMarker(item)}
                    >
                      {item.thumb ? (
                        <Box
                          component="img"
                          src={item.thumb}
                          alt=""
                          // 40px matches the Manage Images / Collections
                          // table thumbnails.
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            display: 'block',
                          }}
                        />
                      ) : (
                        <Room fontSize="small" sx={{ color: markerAccentColor }} />
                      )}
                    </IconButton>
                  </TableCell>
                ),
                title: <TableCell>{item.title}</TableCell>,
                image: (
                  <TableCell>{images[item.image_id]?.name ?? `Image ${item.image_id}`}</TableCell>
                ),
                description: (
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" noWrap title={item.description ?? ''}>
                      {item.description ?? '—'}
                    </Typography>
                  </TableCell>
                ),
                category: (
                  <TableCell>
                    {images[item.image_id]?.category_id != null ? (
                      <CategoryBreadcrumb
                        categoryId={images[item.image_id]?.category_id ?? null}
                        categoryPaths={categoryPaths}
                        onNavigate={onNavigateCategory}
                      />
                    ) : (
                      (item.category_name ?? 'Uncategorized')
                    )}
                  </TableCell>
                ),
                boards: (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {itemBoards(item).map((row, index) => (
                      <Fragment key={row.id}>
                        {index > 0 && ', '}
                        <Link
                          component="button"
                          variant="body2"
                          underline="hover"
                          onClick={() => onSelectBoard(row.id)}
                          sx={{ verticalAlign: 'baseline', textAlign: 'left' }}
                        >
                          {row.name}
                        </Link>
                      </Fragment>
                    ))}
                  </TableCell>
                ),
                favourite: (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {favouriteAction(item)}
                  </TableCell>
                ),
                owner: <TableCell>{item.owners.map((entry) => entry.name).join(', ')}</TableCell>,
                created: (
                  <TableCell>
                    <span title={new Date(item.created_at).toLocaleString()}>
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </TableCell>
                ),
                updated: (
                  <TableCell>
                    <span title={new Date(item.updated_at).toLocaleString()}>
                      {formatRelativeTime(item.updated_at)}
                    </span>
                  </TableCell>
                ),
              }
              return (
                <TableRow
                  key={item.id}
                  hover
                  tabIndex={0}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => {
                    setError(null)
                    setEditingItem(item)
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault()
                      setError(null)
                      setEditingItem(item)
                    }
                  }}
                >
                  <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      size="small"
                      inputProps={{ 'aria-label': `Select ${item.title}` }}
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </TableCell>
                  {orderedMarkerColumns.map((column) => (
                    <Fragment key={column}>{cells[column]}</Fragment>
                  ))}
                  <TableCell
                    align="right"
                    sx={{ whiteSpace: 'nowrap' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconButton
                      size="small"
                      aria-label={`Actions for ${item.title}`}
                      onClick={(event) => {
                        setMenuAnchor(event.currentTarget)
                        setMenuItem(item)
                      }}
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
          component="div"
          count={sorted.length}
          page={currentPage}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[...ROWS_PER_PAGE_OPTIONS]}
          onPageChange={(_, newPage) => setCurrentPage(newPage)}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10))
            setCurrentPage(0)
          }}
        />
      </TableContainer>
    )
  }

  const selectAction = collectionsEnabled && (
    <Button
      size="small"
      variant={selecting ? 'contained' : 'outlined'}
      startIcon={<SelectAll />}
      aria-pressed={selecting}
      sx={{ whiteSpace: 'nowrap' }}
      onClick={() => {
        setSelecting(!selecting)
        setSelection({ boardId, ids: [] })
      }}
    >
      Multi-select
    </Button>
  )
  const selectedItems = (board ? board.markers : filteredItems).filter((item) =>
    selectedIds.includes(item.id),
  )
  const selectionButtons = collectionsEnabled && selectedIds.length > 0 && (
    <Box
      role="toolbar"
      aria-label="Selected Markers"
      sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
        {selectedIds.length} selected
      </Typography>
      <Button
        variant="contained"
        size="small"
        startIcon={<ViewCarousel />}
        disabled={selectedItems.length === 0}
        onClick={() => beginCollection(selectedItems, 'sequence')}
      >
        Create Collection
      </Button>
      <Button
        variant="outlined"
        size="small"
        disabled={selectedItems.length === 0}
        onClick={() => beginCollection(selectedItems, 'sequence', true)}
      >
        Add to Collection
      </Button>
    </Box>
  )
  const viewToggle = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={view}
      aria-label="Markers view"
      sx={[
        ...(Array.isArray(graphToggleSx) ? graphToggleSx : [graphToggleSx]),
        {
          // py keeps the toggle group at the size="small" button height
          // (30.75px) so tops/bottoms align with the row's other buttons.
          '& .MuiToggleButton-root': { gap: 0.75, px: 1.25, py: '3px', textTransform: 'none' },
          '& .MuiToggleButton-root.Mui-selected': {
            color: (theme) =>
              theme.palette.mode === 'light'
                ? theme.palette.primary.dark
                : theme.palette.primary.light,
          },
        },
      ]}
      onChange={(_, value: 'cards' | 'table' | null) => {
        if (value) setView(value)
      }}
    >
      <ToggleButton value="cards" aria-label="Cards view">
        <ViewModule fontSize="small" /> Cards
      </ToggleButton>
      <ToggleButton value="table" aria-label="Table view">
        <TableRows fontSize="small" /> Table
      </ToggleButton>
    </ToggleButtonGroup>
  )
  const collageToolbar = () => (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {boardId != null && (
            <>
              {selectionButtons}
              {selectAction}
            </>
          )}
        </Box>
      </Stack>
    </Box>
  )
  if (!enabled) return null
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: 3,
          flexShrink: 0,
          // Buttons are size="small" (30.75px) — keep the row at the
          // historical 36.5px so the FilterBar position doesn't shift.
          minHeight: 36.5,
        }}
      >
        <Typography variant="h5" component="h1">
          Boards and Markers
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {viewToggle}
          {canBrowseAllBoards && (
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                setDiscoveryFilters([])
                setDiscovery('all')
              }}
            >
              All Boards
            </Button>
          )}
        </Box>
      </Box>
      {(error || data.error) && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button onClick={() => void reload()} disabled={busy}>
              Reload latest
            </Button>
          }
        >
          {error || data.error}
        </Alert>
      )}
      <CollectionEditDialog
        open={!!collectionSource && !collectionSource.add}
        onClose={() => setCollectionSource(null)}
        collection={null}
        defaultType={collectionSource?.type}
        programs={programs}
        groups={groups}
        categories={categories}
        typesAtLimit={studentTypesAtCap(editableCollections.collections, currentUser)}
        onSave={createSeededCollection}
      />
      <AddToCollectionDialog
        slotMode
        open={collectionSource?.add === true}
        onClose={() => setCollectionSource(null)}
        defaultType={collectionSource?.type}
        imageIds={collectionSource?.items.map((item) => item.image_id) ?? []}
        collections={editableCollections.collections}
        loading={editableCollections.loading}
        error={error || editableCollections.error}
        programs={programs}
        groups={groups}
        categories={categories}
        onCreate={createSeededCollection}
        onAdd={async (collection) => {
          if (!collectionSource) return false
          try {
            await addSourcesToCollection(collection.id, collectionSource.sources)
            setCollectionSource(null)
            return true
          } catch (err) {
            setError(
              userMessage(err, "Couldn't add to the collection. Please try again.", {
                includeServerDetail: true,
              }),
            )
            return false
          }
        }}
      />
      <DragDropProvider
        sensors={sensors}
        onDragStart={(event) => {
          const id = event.operation.source?.id
          setActiveItem(
            (board?.markers ?? data.recent).find((item) => `item:${item.id}` === id) ?? null,
          )
        }}
        onDragEnd={dragEnd}
      >
        <FilterBar
          ariaLabel="Filter Boards and Markers"
          actions={
            // Always rendered so the bar keeps the same height in every
            // view — hidden-but-space-reserving outside table view.
            <Button
              size="small"
              startIcon={<ViewColumn fontSize="small" />}
              aria-label="Choose columns"
              aria-hidden={boardId != null || view !== 'table'}
              tabIndex={boardId == null && view === 'table' ? undefined : -1}
              sx={boardId == null && view === 'table' ? undefined : { visibility: 'hidden' }}
              onClick={() => setColumnDialogOpen(true)}
            >
              Choose columns
            </Button>
          }
          clearAction={
            !mobile && filtered ? (
              <Button
                size="small"
                onClick={() => {
                  setQuery('')
                  setScopes([])
                  setOwner('any')
                  setFavourites(false)
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
          summaryActions={
            mobile && filtered ? (
              <Button
                size="small"
                sx={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  setQuery('')
                  setScopes([])
                  setOwner('any')
                  setFavourites(false)
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
          summary={
            filtered ? (
              <Stack direction="row" gap={1} flexWrap="wrap">
                {query && (
                  <Chip size="small" label={`Title: ${query}`} onDelete={() => setQuery('')} />
                )}
                {scopes.map((scope) => (
                  <Chip
                    key={scope}
                    size="small"
                    label={scope[0].toUpperCase() + scope.slice(1)}
                    onDelete={() => setScopes(scopes.filter((s) => s !== scope))}
                  />
                ))}
                {owner !== 'any' && (
                  <Chip
                    size="small"
                    label={
                      owner === 'mine' ? 'Mine' : ownerOptions.find((o) => o.value === owner)?.label
                    }
                    onDelete={() => setOwner('any')}
                  />
                )}
                {favourites && (
                  <Chip size="small" label="Favourites" onDelete={() => setFavourites(false)} />
                )}
              </Stack>
            ) : undefined
          }
        >
          <FilterPopoverButton
            label="Title"
            activeCount={query ? 1 : 0}
            sx={{ color: 'text.primary' }}
          >
            <FilterTextPanel
              value={query}
              onChange={setQuery}
              placeholder="Filter by title or description"
              ariaLabel="Filter Boards and Markers by title"
            />
          </FilterPopoverButton>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              Scope:
            </Typography>
            {(['private', 'restricted', 'public'] as const).map((value) => {
              const active = scopes.includes(value)
              return (
                <Chip
                  key={value}
                  size="small"
                  sx={{ px: 0.5 }}
                  label={value[0].toUpperCase() + value.slice(1)}
                  variant={active ? 'filled' : 'outlined'}
                  color={active ? 'primary' : 'default'}
                  aria-pressed={active}
                  onClick={() =>
                    setScopes((current) =>
                      active ? current.filter((scope) => scope !== value) : [...current, value],
                    )
                  }
                />
              )
            })}
          </Box>
          <FilterPopoverButton
            label="Owner"
            activeCount={owner === 'any' ? 0 : 1}
            sx={{ color: 'text.primary' }}
          >
            <FilterOptionPanel
              multiple={false}
              options={[
                { value: 'any', label: 'Anyone' },
                { value: 'mine', label: 'Mine' },
                ...ownerOptions,
              ]}
              selectedValues={[owner]}
              onChange={(values) => setOwner(values[0] ?? 'any')}
            />
          </FilterPopoverButton>
          <Chip
            size="small"
            sx={{ px: 0.5 }}
            label="Favourites"
            variant={favourites ? 'filled' : 'outlined'}
            color={favourites ? 'primary' : 'default'}
            aria-pressed={favourites}
            onClick={() => setFavourites(!favourites)}
          />
        </FilterBar>
        <Box
          role="region"
          aria-label="Boards"
          sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pt: 1.25, pb: 2, mb: 1 }}
        >
          <Button
            variant="outlined"
            aria-label="New Board"
            onClick={() => {
              setError(null)
              setEdit('new')
            }}
            sx={{
              flexShrink: 0,
              alignSelf: 'stretch',
              minWidth: 56,
              px: 1,
              borderRadius: 2,
              borderWidth: 2,
              borderColor: markerAccentColor,
              color: markerAccentColor,
              boxShadow: (theme) => theme.shadows[2],
            }}
          >
            <Add />
          </Button>
          {rows.map((row) => (
            <SortableFrame
              key={row.id}
              id={`board:${row.id}`}
              index={reorderableBoards.findIndex((b) => b.id === row.id)}
              type="board-card"
              group="boards"
              disabled={filtered || !reorderableBoards.some((b) => b.id === row.id)}
              label={row.name}
              hideHandle
            >
              <DropArea
                id={`save:${row.id}`}
                label={`Save to ${row.name}`}
                enabled={
                  !!activeItem?.permissions.can_edit &&
                  row.permissions.can_edit &&
                  !activeItem.board_ids.includes(row.id)
                }
                blocked={!!activeItem?.board_ids.includes(row.id)}
              >
                <Card
                  elevation={2}
                  sx={{
                    position: 'relative',
                    borderRadius: 2,
                    borderWidth: 2,
                    borderStyle: 'solid',
                    borderColor: (theme) =>
                      row.id === boardId ? theme.palette.primary.main : markerAccentColor(theme),
                  }}
                >
                  {row.permissions.can_edit && (
                    // Cover picker — pins the tile image like the
                    // Collection tile's "Set cover image" action (#1554).
                    <Tooltip title="Set cover image">
                      <IconButton
                        size="small"
                        aria-label={`Set ${row.name} cover image`}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          if (busy) return
                          openCoverPicker(row)
                        }}
                        sx={{
                          position: 'absolute',
                          top: 4,
                          right: 8,
                          zIndex: 1,
                          color: 'common.white',
                          bgcolor: (theme) => alpha(theme.palette.common.black, 0.25),
                          '&:hover': {
                            bgcolor: (theme) => alpha(theme.palette.common.black, 0.45),
                          },
                        }}
                      >
                        <ImageIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <CardActionArea
                    onClick={() => onSelectBoard(row.id)}
                    aria-label={`Open Board: ${row.name}`}
                    sx={{
                      display: 'flex',
                      justifyContent: 'flex-start',
                      alignItems: 'stretch',
                      gap: 1,
                    }}
                  >
                    <BoardCover board={row} />
                    <Stack
                      // Right padding aligns the scope chip's right edge with
                      // the cover-picker icon's (both 8px from the tile edge).
                      sx={{ justifyContent: 'center', pl: 1.5, pr: 1, minWidth: 0, flex: 1 }}
                      alignItems="stretch"
                    >
                      <Typography
                        variant="h6"
                        component="p"
                        noWrap
                        fontWeight={600}
                        title={row.name}
                      >
                        {row.name}
                      </Typography>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 0.5,
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {`${row.marker_count} ${row.marker_count === 1 ? 'Marker' : 'Markers'}`}
                        </Typography>
                        <CollectionVisibilityChip visibility={row.visibility} />
                      </Box>
                    </Stack>
                  </CardActionArea>
                </Card>
              </DropArea>
            </SortableFrame>
          ))}
        </Box>

        <Dialog
          open={discovery === 'all' && canBrowseAllBoards}
          onClose={() => setDiscovery(null)}
          fullWidth
          maxWidth="lg"
          aria-labelledby="all-boards-title"
        >
          <DialogTitle id="all-boards-title">All Boards</DialogTitle>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', px: 3, pb: 1 }}>
            {(['shared', 'instructor'] as const).map((filter) => {
              const active = discoveryFilters.includes(filter)
              const toggle = () =>
                setDiscoveryFilters((current) =>
                  active ? current.filter((value) => value !== filter) : [...current, filter],
                )
              return (
                <Chip
                  key={filter}
                  size="small"
                  label={filter === 'shared' ? 'Public & Shared' : 'Instructor Boards'}
                  variant={active ? 'filled' : 'outlined'}
                  color={active ? 'primary' : 'default'}
                  aria-pressed={active}
                  onClick={toggle}
                />
              )
            })}
          </Box>
          <DialogContent>
            {data.loading ? (
              <CircularProgress aria-label="Loading all Boards" size={24} />
            ) : data.error ? (
              <Alert severity="error">{data.error}</Alert>
            ) : discoveryBoards.length ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                {discoveryBoards.map((row) => {
                  return (
                    <Card key={row.id} variant="outlined">
                      <CardActionArea
                        onClick={() => {
                          setDiscovery(null)
                          onSelectBoard(row.id)
                        }}
                        aria-label={`Open Board: ${row.name}`}
                        sx={{ height: '100%' }}
                      >
                        <CardContent>
                          <Typography
                            component="h3"
                            variant="body2"
                            fontWeight={600}
                            sx={{ overflowWrap: 'anywhere' }}
                          >
                            {row.name}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="p"
                            sx={{ mb: 1, overflowWrap: 'anywhere' }}
                          >
                            {boardManagerText(row)}
                          </Typography>
                          <CollectionVisibilityChip visibility={row.visibility} />
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  )
                })}
              </Box>
            ) : (
              <Typography color="text.secondary">
                {discoveryFilters.length ? 'No matching Boards.' : 'No Boards available.'}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => setDiscovery(null)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
        {data.loading && <CircularProgress aria-label="Loading Boards" size={24} />}
        {!data.loading && (!data.error || data.boards.length > 0 || data.recent.length > 0) && (
          <>
            {boardId == null && view === 'table' && selectionButtons}
            {view === 'cards' ? (
              <Box
                sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 234px)', gap: 2 }}
              >
                {filteredItems.map((item, index) => memberCard(item, index))}
              </Box>
            ) : (
              memberTable(filteredItems)
            )}
            {!filteredItems.length && (
              <Typography color="text.secondary">
                {filtered
                  ? 'No matching Markers.'
                  : 'No Markers yet. Save a view from an image to start your collection.'}
              </Typography>
            )}
          </>
        )}
        <Dialog
          open={boardId != null}
          onClose={() => onSelectBoard(null)}
          fullScreen={mobile}
          fullWidth
          maxWidth="lg"
          aria-labelledby="board-dialog-title"
          slotProps={{ paper: { sx: { height: { xs: '100%', sm: '85vh' } } } }}
        >
          <DialogTitle id="board-heading" component="div">
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                <Typography
                  id="board-dialog-title"
                  component="h2"
                  variant="h6"
                  sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {boardSummary ? `${boardSummary.name} Board` : 'Board'}
                </Typography>
                {boardSummary && (
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
                    ({boardSummary.marker_count}{' '}
                    {boardSummary.marker_count === 1 ? 'marker' : 'markers'})
                  </Typography>
                )}
                {board?.permissions.can_edit && (
                  <IconButton
                    size="small"
                    aria-label="Edit Board"
                    disabled={busy || conflict}
                    onClick={() => setEdit('edit')}
                  >
                    <Edit sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
              {collectionsEnabled && board && !selecting && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ViewCarousel />}
                  disabled={!board.markers.length || busy || conflict}
                  onClick={() =>
                    beginCollection(board.markers, 'sequence', false, {
                      source_board_id: board.id,
                    })
                  }
                >
                  Create Collection
                </Button>
              )}
              <IconButton aria-label="Close Board" onClick={() => onSelectBoard(null)}>
                <Close />
              </IconButton>
            </Stack>
            {boardSummary && (
              <>
                <Box
                  role="group"
                  aria-label="Board scope and owners"
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1,
                    mb: 1,
                    mt: 1,
                  }}
                >
                  <CollectionVisibilityChip visibility={boardSummary.visibility} />
                  <Box
                    sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {boardManagerText(boardSummary)}
                    </Typography>
                    {boardSummary.permissions.can_transfer && (
                      <Tooltip title="Manage owners">
                        <IconButton
                          size="small"
                          aria-label="Manage owners"
                          disabled={busy || conflict}
                          sx={{ ml: 0.25, p: 0.25 }}
                          onClick={() => setOwners(true)}
                        >
                          <SwapHoriz fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
                {boardSummary.description && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1, maxHeight: 72, overflowY: 'auto' }}
                  >
                    {boardSummary.description}
                  </Typography>
                )}
                {collageToolbar()}
              </>
            )}
          </DialogTitle>
          <DialogContent sx={{ pt: '16px !important' }}>
            {(error || data.error) && (
              <Alert
                severity="error"
                action={
                  <Button size="small" onClick={() => void reload()}>
                    Reload latest
                  </Button>
                }
              >
                {error || data.error}
              </Alert>
            )}
            {data.boardLoading && <CircularProgress aria-label="Loading Board" size={24} />}
            {board && (
              <>
                <Box
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 234px)', gap: 2 }}
                >
                  {board.markers.map((item, index) => memberCard(item, index, true))}
                </Box>
                {!board.markers.length && (
                  <Typography color="text.secondary">
                    No Markers yet. Save a view from an image.
                  </Typography>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      </DragDropProvider>
      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose columns"
        columns={orderedMarkerColumnOptions}
        visibleColumns={markerColumns}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={toggleMarkerColumn}
        onReorderColumns={setMarkerColumnOrder}
      />
      <BoardCoverPickerModal
        open={coverPicker != null}
        markers={coverPickerMarkers}
        currentMarkerId={coverPicker?.cover_marker_id ?? null}
        currentBlank={coverPicker?.cover_blank ?? false}
        onClose={() => setCoverPicker(null)}
        onSave={(markerId, blank) => void saveCover(markerId, blank)}
      />
      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setNotice(null)
        }}
      >
        <Alert
          variant="filled"
          severity={notice?.severity ?? 'info'}
          sx={(theme) => {
            const colors = theme.palette[notice?.severity ?? 'info']
            const background = theme.palette.mode === 'dark' ? colors.dark : colors.main
            return {
              color:
                getContrastRatio(background, theme.palette.common.white) >= 4.5
                  ? theme.palette.common.white
                  : theme.palette.common.black,
            }
          }}
          action={
            notice?.undo ? (
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={() => {
                  if (notice.undo) undoNotice(notice.undo)
                }}
              >
                Undo
              </Button>
            ) : undefined
          }
          onClose={() => setNotice(null)}
        >
          {notice?.message}
        </Alert>
      </Snackbar>
      {edit && (edit === 'new' || board) && (
        <BoardEditDialog
          board={edit === 'edit' ? board : null}
          programs={programs}
          groups={groups}
          onClose={() => setEdit(null)}
          onSaved={(saved) => {
            data.upsertBoard(saved)
            if (edit === 'new') onSelectBoard(saved.id)
            else void data.reload()
          }}
          onDeleted={() => {
            onSelectBoard(null)
            void data.reload()
          }}
        />
      )}
      {owners && board && (
        <BoardOwnersDialog
          board={board}
          programs={programs}
          onClose={() => setOwners(false)}
          onSaved={() => {
            void data.reload()
          }}
        />
      )}
      {editingItem && (
        <MarkerFormDialog
          item={editingItem}
          imageId={editingItem.image_id}
          view={editingItem}
          userId={currentUser?.id}
          onClose={() => setEditingItem(null)}
          onChanged={data.reload}
          onViewMarker={() => {
            const item = editingItem
            setEditingItem(null)
            onOpenMarker(item)
          }}
          onRemoveFromBoard={
            board?.permissions.can_edit
              ? () => {
                  setRemovingItem(editingItem)
                  setEditingItem(null)
                }
              : undefined
          }
        />
      )}
      {/* Row action menu — one kebab per table row; items are gated on the
          target row's permissions, so the menu keeps a snapshot of its row
          (same convention as the Collections table). */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => {
          setMenuAnchor(null)
          setMenuItem(null)
        }}
      >
        <MenuItem
          onClick={() => {
            const item = menuItem
            setMenuAnchor(null)
            setMenuItem(null)
            if (item) onOpenMarker(item)
          }}
        >
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View Marker</ListItemText>
        </MenuItem>
        {(menuItem?.permissions.can_edit || board?.permissions.can_edit) && (
          <MenuItem
            onClick={() => {
              const item = menuItem
              setMenuAnchor(null)
              setMenuItem(null)
              if (item) {
                setError(null)
                setEditingItem(item)
              }
            }}
          >
            <ListItemIcon>
              <Edit fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit Details</ListItemText>
          </MenuItem>
        )}
        {menuItem?.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              const item = menuItem
              setMenuAnchor(null)
              setMenuItem(null)
              if (item) {
                setError(null)
                setSavingItem(item)
              }
            }}
          >
            <ListItemIcon>
              <DriveFileMove fontSize="small" />
            </ListItemIcon>
            <ListItemText>Move/Save to Board</ListItemText>
          </MenuItem>
        )}
        {menuItem?.permissions.can_delete && (
          <MenuItem
            onClick={() => {
              const item = menuItem
              setMenuAnchor(null)
              setMenuItem(null)
              if (item) {
                setError(null)
                setDeletingItem(item)
              }
            }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText sx={{ color: 'primary.main' }}>Delete</ListItemText>
          </MenuItem>
        )}
      </Menu>
      {deletingItem && (
        <Dialog open onClose={busy ? undefined : () => setDeletingItem(null)}>
          <DialogTitle>Delete Marker?</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}“{deletingItem.title}” will be
            permanently deleted from all its Boards. This cannot be undone.
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => setDeletingItem(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="small"
              color="error"
              variant="contained"
              disabled={busy || conflict}
              onClick={() => {
                const item = deletingItem
                void run(() => deleteMarker(item.id, item.version)).then((ok) => {
                  if (ok) setDeletingItem(null)
                })
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {savingItem && (
        <SaveToDialog
          item={savingItem}
          boards={data.boards}
          source={board}
          busy={busy}
          conflict={conflict}
          onReload={() => void reload()}
          error={error}
          onClose={() => setSavingItem(null)}
          onSave={(targetId, move) => {
            const destination = data.boards.find((row) => row.id === targetId)
            let undo: NoticeUndo | undefined
            void run(async () => {
              undo = await saveToBoard(savingItem, targetId, move ? boardId : null)
            }).then((ok) => {
              if (!ok) return
              setSavingItem(null)
              notify(
                `${move ? 'Moved' : 'Saved'} to ${destination?.name ?? 'Board'}`,
                'success',
                undo,
              )
            })
          }}
        />
      )}
      {removingItem && board && (
        <Dialog open onClose={busy ? undefined : () => setRemovingItem(null)}>
          <DialogTitle>Remove from this Board?</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}Remove “{removingItem.title}” from “
            {board.name}”? A Marker must remain on at least one Board.
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => setRemovingItem(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="small"
              disabled={busy || conflict}
              onClick={() => {
                void run(() => removeBoardMarker(board.id, removingItem.id, board.version)).then(
                  (ok) => {
                    if (ok) setRemovingItem(null)
                  },
                )
              }}
            >
              Remove
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
