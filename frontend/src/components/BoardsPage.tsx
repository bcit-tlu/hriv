import Checkbox from '@mui/material/Checkbox'
import CollectionEditDialog from './CollectionEditDialog'
import type { CollectionFormValues } from './CollectionEditDialog'
import AddToCollectionDialog from './AddToCollectionDialog'
import {
  addSourcesToCollection,
  createCollectionFromSources,
  useEditableCollections,
} from '../useAddToCollection'
import {
  apiCollectionOwnerToOwner,
  describeCollectionOwners,
  studentTypesAtCap,
} from '../collectionUtils'
import type { Category, CollectionType } from '../types'
import type { CollectionSources } from '../api'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import Room from '@mui/icons-material/Room'
import DragIndicator from '@mui/icons-material/DragIndicator'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import DriveFileMove from '@mui/icons-material/DriveFileMove'
import ViewModule from '@mui/icons-material/ViewModule'
import TableRows from '@mui/icons-material/TableRows'
import { CollectionVisibilityChip } from './CollectionCard'
import { graphToggleSx } from '../collectionsGraph/toggleStyles'
import Add from '@mui/icons-material/Add'
import Edit from '@mui/icons-material/Edit'
import Close from '@mui/icons-material/Close'
import SwapHoriz from '@mui/icons-material/SwapHoriz'
import ViewCarousel from '@mui/icons-material/ViewCarousel'
import { alpha, getContrastRatio, useTheme } from '@mui/material/styles'
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
  fetchBoard,
  fetchMarker,
  fetchMarkers,
  removeBoardMarker,
  reorderBoardMarkers,
  reorderBoards,
  updateMarker,
  userMessage,
} from '../api'
import { moveBoardMember, ownsBoard } from '../boardUtils'
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
import BoardEditDialog from './BoardEditDialog'
import BoardOwnersDialog from './BoardOwnersDialog'
import MarkerFormDialog from './MarkerFormDialog'
import RenewingThumbnail from './RenewingThumbnail'
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
}

function boardManagerText(board: ApiBoardSummary) {
  const owners = board.owners.flatMap((owner) => {
    const mapped = apiCollectionOwnerToOwner(owner)
    return mapped ? [mapped] : []
  })
  const programOwner = owners.find((owner) => owner.kind === 'program')
  return programOwner
    ? `Managed by program ${programOwner.name}`
    : owners.length
      ? `Managed by ${describeCollectionOwners(owners)}`
      : 'No owner'
}

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
      sx={{ position: 'relative', minWidth: 0, opacity: isDragSource ? 0.5 : 1 }}
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
        outline: isDragSource ? '2px dashed' : undefined,
        outlineColor: 'primary.main',
        minWidth: 0,
        ...(type === 'board-card' && { flex: '0 0 auto', maxWidth: 280 }),
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
  children,
}: {
  id: string
  label: string
  enabled: boolean
  children: ReactNode
}) {
  const { ref, isDropTarget } = useDroppable({
    id,
    type: 'board-member-bin',
    accept: 'board-member',
    collisionPriority: CollisionPriority.Low,
  })
  return (
    <Box
      ref={ref}
      role="region"
      aria-label={label}
      sx={{
        borderRadius: 2,
        outline: enabled && isDropTarget ? '3px solid' : undefined,
        outlineColor: 'primary.main',
        minHeight: 0,
      }}
    >
      {children}
    </Box>
  )
}

function BoardCover({ board }: { board: ApiBoardSummary }) {
  const [state, setState] = useState<{ id: number; items: ApiMarker[] } | null>(null)
  const key = `${board.id}:${board.version}`
  useEffect(() => {
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
  }, [board.id, key])
  const item = state?.id === board.id ? state.items.find((item) => item.thumb != null) : undefined
  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        flexShrink: 0,
        bgcolor: 'action.hover',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {board.cover_thumb ? (
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

async function saveToBoard(item: ApiMarker, targetId: number, sourceId: number | null) {
  const fresh = await fetchMarker(item.id)
  const boards = await Promise.all(fresh.board_ids.map((fetchBoardId) => fetchBoard(fetchBoardId)))
  const assignments: BoardAssignment[] = []
  for (const board of boards) {
    if (!board.permissions.can_edit || board.id === sourceId || board.id === targetId) continue
    const link = board.markers.find((member) => member.id === fresh.id)
    if (!link) throw new Error('Board membership changed. Reload before saving.')
    assignments.push({
      board_id: board.id,
      sort_order: link.sort_order,
    })
  }
  assignments.push({ board_id: targetId })
  await updateMarker(fresh.id, { version: fresh.version, board_assignments: assignments })
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
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {(error || loadError) && (
            <Alert
              severity="error"
              action={
                conflict ? (
                  <Button onClick={onReload}>Reload latest</Button>
                ) : loadError ? (
                  <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
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
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
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
}: BoardsPageProps) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
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
  const [discovery, setDiscovery] = useState<'shared' | 'all' | null>(null)
  const [notice, setNotice] = useState<{
    message: string
    severity: 'success' | 'info' | 'warning'
  } | null>(null)
  const notify = (message: string, severity: 'success' | 'info' | 'warning' = 'warning') =>
    setNotice({ message, severity })
  const [favourites, setFavourites] = useState(false)
  const data = useBoardsData(boardId, favourites, enabled)
  const board = data.board
  const [edit, setEdit] = useState<'new' | 'edit' | null>(null)
  const [owners, setOwners] = useState(false)
  const [savingItem, setSavingItem] = useState<ApiMarker | null>(null)
  const [removingItem, setRemovingItem] = useState<ApiMarker | null>(null)
  const [editingItem, setEditingItem] = useState<ApiMarker | null>(null)
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
  const publicBoards = data.boards.filter(
    (row) =>
      (!ownsBoard(row, currentUser) || !row.permissions.can_edit) &&
      (row.visibility !== 'private' || ownsBoard(row, currentUser)),
  )
  const canBrowseAllBoards =
    currentUser != null && ['admin', 'instructor', 'staff'].includes(currentUser.role)
  const discoveryBoards = discovery === 'all' && canBrowseAllBoards ? data.boards : publicBoards
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
  const filteredItems = data.recent
    .filter(
      (item) =>
        item.owners.some((o) => o.user_id === currentUser?.id) &&
        (!needle ||
          `${item.title} ${item.description ?? ''}`.toLocaleLowerCase().includes(needle)) &&
        (!scopes.length || item.board_ids.some((id) => scopeIds.has(id))) &&
        ownerMatches(item) &&
        (!favourites || item.favourite),
    )
    .sort(
      (a, b) =>
        a.title.toLocaleLowerCase().localeCompare(b.title.toLocaleLowerCase()) || a.id - b.id,
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
      if (ids)
        void run(() =>
          reorderBoards(
            ids.flatMap((id) => {
              const row = reorderableBoards.find((candidate) => `board:${candidate.id}` === id)
              return row ? [{ board_id: row.id, version: row.version }] : []
            }),
          ),
        )
    } else if (source.type === 'board-member' && target) {
      const item = (board?.markers ?? data.recent).find((row) => `item:${row.id}` === source.id)
      if (!item) {
        notify('This Marker is no longer available. Reload before saving.')
        return
      }
      const key = String(target.id)
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
        void run(() => saveToBoard(item, destination.id, null)).then((ok) => {
          if (ok) notify(`Saved to ${destination.name}`, 'success')
        })
      } else if (board && canEdit) {
        const targetItem = board.markers.find((row) => `item:${row.id}` === target.id)
        if (!targetItem) {
          notify('This drop target is no longer available. Reload before reordering.')
          return
        }
        const index = isSortable(source) ? source.index : board.markers.indexOf(targetItem)
        void run(() =>
          reorderBoardMarkers(board.id, {
            version: board.version,
            items: moveBoardMember(board, item.id, index),
          }),
        )
      } else if (board) {
        notify(`You can't reorder Markers in ${board.name}`)
      }
    }
  }
  const itemBoards = (item: ApiMarker) =>
    data.boards.filter((row) => item.board_ids.includes(row.id))
  const scopePills = (item: ApiMarker) => (
    <Stack direction="row" gap={0.5} flexWrap="wrap">
      {[...new Set(itemBoards(item).map((row) => row.visibility))].map((visibility) => (
        <CollectionVisibilityChip key={visibility} visibility={visibility} />
      ))}
    </Stack>
  )
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
          sx={
            item.favourite
              ? { bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }
              : undefined
          }
          disabled={busy || conflict}
          onClick={() =>
            void run(() =>
              updateMarker(item.id, { version: item.version, favourite: !item.favourite }),
            )
          }
        >
          {item.favourite ? (
            <Star sx={{ color: 'common.white' }} fontSize="small" />
          ) : (
            <StarBorder fontSize="small" />
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
          disabled={busy || conflict}
          onClick={() => {
            setError(null)
            setEditingItem(item)
          }}
        >
          <Edit sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    )
  const moveAction = (item: ApiMarker) =>
    item.permissions.can_edit && (
      <Tooltip title="Move/Save to Board">
        <IconButton
          size="small"
          aria-label={`Move/Save ${item.title} to Board`}
          disabled={busy || conflict}
          onClick={() => {
            setError(null)
            setSavingItem(item)
          }}
        >
          <DriveFileMove fontSize="small" />
        </IconButton>
      </Tooltip>
    )
  const selectionAction = (item: ApiMarker) =>
    selecting && (
      <Checkbox
        size="small"
        checked={selectedIds.includes(item.id)}
        onChange={() => toggleSelected(item.id)}
        inputProps={{ 'aria-label': `Select ${item.title}` }}
      />
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
      sortable={inBoard}
      label={item.title}
    >
      <Card elevation={2} data-testid="marker-card" sx={{ position: 'relative', height: '100%' }}>
        <Box sx={{ position: 'relative' }}>
          <CardActionArea
            onClick={() => (selecting ? toggleSelected(item.id) : onOpenMarker(item))}
            aria-label={`Open Marker: ${item.title}`}
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
          </CardActionArea>
          <Box
            sx={(theme) => ({
              position: 'absolute',
              top: 4,
              right: 4,
              display: 'flex',
              gap: 0.5,
              '& .MuiIconButton-root': {
                color: theme.palette.common.white,
                bgcolor: alpha(theme.palette.common.black, 0.25),
                '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.45) },
              },
            })}
          >
            {favouriteAction(item)}
            {moveAction(item)}
          </Box>
        </Box>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" alignItems="flex-start" gap={0.5}>
            <Room color="primary" sx={{ fontSize: 24, flexShrink: 0 }} />
            <Button
              onClick={() => (selecting ? toggleSelected(item.id) : onOpenMarker(item))}
              title={item.title}
              sx={{
                p: 0,
                minWidth: 0,
                flex: 1,
                textTransform: 'none',
                justifyContent: 'flex-start',
                textAlign: 'left',
              }}
            >
              <Typography
                component="h3"
                variant="body2"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                }}
              >
                {item.title}
              </Typography>
            </Button>
            {editAction(item)}
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            title={item.category_name ?? 'Uncategorized'}
          >
            {item.category_name ?? 'Uncategorized'}
          </Typography>
          <Box sx={{ mt: 0.5 }}>{scopePills(item)}</Box>
          {selectionAction(item)}
        </CardContent>
      </Card>
    </SortableFrame>
  )
  const memberTable = (items: ApiMarker[]) => (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="Markers">
        <TableHead
          sx={{
            '& .MuiTableCell-head': { bgcolor: (theme) => filterSurfaceBg(theme), fontWeight: 600 },
          }}
        >
          <TableRow>
            {selecting && <TableCell>Select</TableCell>}
            {['Title', 'Category', 'Scope', 'Boards', 'Favourite', 'Actions'].map((label) => (
              <TableCell key={label}>{label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              hover
              tabIndex={0}
              sx={{ cursor: 'pointer' }}
              onClick={() => onOpenMarker(item)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault()
                  onOpenMarker(item)
                }
              }}
            >
              {selecting && (
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {selectionAction(item)}
                </TableCell>
              )}
              <TableCell>{item.title}</TableCell>
              <TableCell>{item.category_name ?? 'Uncategorized'}</TableCell>
              <TableCell>{scopePills(item)}</TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                {itemBoards(item).map((row) => (
                  <Button
                    key={row.id}
                    size="small"
                    onClick={() => onSelectBoard(row.id)}
                    sx={{ textTransform: 'none' }}
                  >
                    {row.name}
                  </Button>
                ))}
              </TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                {favouriteAction(item)}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }} onClick={(event) => event.stopPropagation()}>
                {moveAction(item)}
                {editAction(item)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )

  const selectAction = collectionsEnabled && (
    <Button
      variant="outlined"
      aria-pressed={selecting}
      sx={{ whiteSpace: 'nowrap' }}
      onClick={() => {
        setSelecting(!selecting)
        setSelection({ boardId, ids: [] })
      }}
    >
      {selecting ? 'Cancel selection' : 'Select'}
    </Button>
  )
  const collageToolbar = (title: string) => (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {title === 'My Markers' && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              aria-label="Markers view"
              sx={[
                ...(Array.isArray(graphToggleSx) ? graphToggleSx : [graphToggleSx]),
                {
                  '& .MuiToggleButton-root': { gap: 0.75, px: 1.25, textTransform: 'none' },
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
          )}
          {boardId != null && selectAction}
        </Box>
      </Stack>
      {collectionsEnabled && selecting && (
        <Stack
          role="toolbar"
          aria-label="Selected Markers"
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
        >
          <Typography sx={{ alignSelf: 'center' }}>{selectedIds.length} selected</Typography>
          {(['sequence', 'synchronized'] as const).map((type) => {
            const items = (board ? board.markers : filteredItems).filter((item) =>
              selectedIds.includes(item.id),
            )
            const valid =
              items.length > 0 && (type === 'sequence' || (items.length >= 2 && items.length <= 4))
            const label = type === 'sequence' ? 'Sequence' : 'Synchronized'
            return (
              <Box key={type} sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  disabled={!valid}
                  onClick={() => beginCollection(items, type)}
                >
                  Create {label} Collection
                </Button>
                <Button
                  variant="outlined"
                  disabled={!valid}
                  onClick={() => beginCollection(items, type, true)}
                >
                  Add to {label} Collection
                </Button>
              </Box>
            )
          })}
        </Stack>
      )}
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
        }}
      >
        <Typography variant="h5" component="h1">
          My Boards
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1 }}>
          <Button variant="outlined" onClick={() => setDiscovery('shared')}>
            Public &amp; shared Boards
          </Button>
          {canBrowseAllBoards && (
            <Button variant="outlined" onClick={() => setDiscovery('all')}>
              All Boards
            </Button>
          )}
        </Box>
      </Box>
      {boardId != null && !board && (
        <Button onClick={() => onSelectBoard(null)}>All Markers</Button>
      )}
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
        collections={editableCollections.collections.filter(
          (collection) => collection.type === collectionSource?.type,
        )}
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
        <Box
          role="region"
          aria-label="Boards"
          sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', py: 2, mb: 2 }}
        >
          <Card variant="outlined" sx={{ flexShrink: 0, borderRadius: 2 }}>
            <CardActionArea
              onClick={() => {
                setError(null)
                setEdit('new')
              }}
              sx={{
                height: '100%',
                minHeight: 48,
                display: 'flex',
                flexDirection: 'row',
                gap: 1,
                pr: 2,
                justifyContent: 'center',
              }}
            >
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'action.hover',
                }}
              >
                <Add />
              </Box>
              <Typography variant="body2">New Board</Typography>
            </CardActionArea>
          </Card>
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
              >
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    borderColor: row.id === boardId ? 'primary.main' : 'divider',
                  }}
                >
                  <CardActionArea
                    onClick={() => onSelectBoard(row.id)}
                    aria-label={`Open Board: ${row.name}`}
                    sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}
                  >
                    <BoardCover board={row} />
                    <Typography
                      variant="body2"
                      component="p"
                      noWrap
                      fontWeight={600}
                      sx={{
                        px: 1,
                        py: 0.75,
                      }}
                      title={row.name}
                    >
                      {row.name}
                    </Typography>
                  </CardActionArea>
                </Card>
              </DropArea>
            </SortableFrame>
          ))}
        </Box>

        <Dialog
          open={discovery === 'shared' || (discovery === 'all' && canBrowseAllBoards)}
          onClose={() => setDiscovery(null)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="public-boards-title"
        >
          <DialogTitle id="public-boards-title">
            {discovery === 'all' ? 'All Boards' : 'Public & shared Boards'}
          </DialogTitle>
          <DialogContent>
            {data.loading ? (
              <CircularProgress
                aria-label={
                  discovery === 'all' ? 'Loading all Boards' : 'Loading public and shared Boards'
                }
                size={24}
              />
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
                {discovery === 'all'
                  ? 'No Boards available.'
                  : 'No public or shared Boards available.'}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDiscovery(null)}>Close</Button>
          </DialogActions>
        </Dialog>
        {!boardId && collageToolbar('My Markers')}
        <FilterBar
          ariaLabel="Filter Boards and Markers"
          actions={boardId == null ? selectAction : undefined}
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
          <FilterPopoverButton
            label="Scope"
            activeCount={scopes.length}
            sx={{ color: 'text.primary' }}
          >
            <FilterOptionPanel
              options={['private', 'restricted', 'public'].map((value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              }))}
              selectedValues={scopes}
              onChange={setScopes}
            />
          </FilterPopoverButton>
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
          <FilterPopoverButton
            label="Favourite"
            activeCount={favourites ? 1 : 0}
            sx={{ color: 'text.primary' }}
          >
            <FilterOptionPanel
              multiple={false}
              options={[{ value: 'favourite', label: 'Favourites only' }]}
              selectedValues={favourites ? ['favourite'] : []}
              onChange={(values) => setFavourites(values.length > 0)}
            />
          </FilterPopoverButton>
        </FilterBar>
        {data.loading && <CircularProgress aria-label="Loading Boards" size={24} />}
        {!data.loading && (!data.error || data.boards.length > 0 || data.recent.length > 0) && (
          <>
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
          <DialogTitle
            id="board-heading"
            component="div"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                <Typography
                  id="board-dialog-title"
                  component="h2"
                  variant="h6"
                  sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {board?.name ?? 'Board'}
                </Typography>
                {board && (
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
                    ({board.marker_count} Markers)
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
              {collectionsEnabled && board && (
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
            {board && (
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
                  <CollectionVisibilityChip visibility={board.visibility} />
                  <Box
                    sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {boardManagerText(board)}
                    </Typography>
                    {board.permissions.can_transfer && (
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
                {board.description && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1, maxHeight: 72, overflowY: 'auto' }}
                  >
                    {board.description}
                  </Typography>
                )}
                {collageToolbar('Saved views')}
              </>
            )}
          </DialogTitle>
          <DialogContent sx={{ pt: '16px !important' }}>
            {(error || data.error) && (
              <Alert
                severity="error"
                action={<Button onClick={() => void reload()}>Reload latest</Button>}
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
            void run(() => saveToBoard(savingItem, targetId, move ? boardId : null)).then((ok) => {
              if (ok) setSavingItem(null)
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
            <Button onClick={() => setRemovingItem(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
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
