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
  Menu,
  MenuItem,
  Stack,
  Switch,
  Snackbar,
  useMediaQuery,
  TextField,
  Typography,
} from '@mui/material'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import CompassCalibration from '@mui/icons-material/CompassCalibration'
import DragIndicator from '@mui/icons-material/DragIndicator'
import Favorite from '@mui/icons-material/Favorite'
import FavoriteBorder from '@mui/icons-material/FavoriteBorder'
import MoreVert from '@mui/icons-material/MoreVert'
import Add from '@mui/icons-material/Add'
import Edit from '@mui/icons-material/Edit'
import Close from '@mui/icons-material/Close'
import { useTheme } from '@mui/material/styles'
import FilterBar from './FilterBar'
import FilterPopoverButton from './FilterPopoverButton'
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
  deleteBoard,
  fetchBoard,
  fetchInuksuk,
  fetchInuksuks,
  removeBoardInuksuk,
  reorderBoardInuksuks,
  reorderBoards,
  updateInuksuk,
  userMessage,
} from '../api'
import { moveBoardMember, ownsBoard } from '../boardUtils'
import type {
  ApiBoard,
  ApiBoardSummary,
  ApiInuksuk,
  BoardAssignment,
  Group,
  Program,
  User,
} from '../types'
import { useBoardsData } from '../useBoardsData'
import BoardEditDialog from './BoardEditDialog'
import BoardOwnersDialog from './BoardOwnersDialog'
import InuksukFormDialog from './InuksukFormDialog'
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
  onOpenInuksuk: (item: ApiInuksuk) => void
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
}

function SortableFrame(props: SortableFrameProps) {
  return props.sortable === false ? (
    <DraggableFrame {...props} />
  ) : (
    <ActiveSortableFrame {...props} />
  )
}

function DraggableFrame({ id, label, children, disabled }: SortableFrameProps) {
  const { ref, handleRef, isDragSource } = useDraggable({ id, type: 'board-member', disabled })
  return (
    <Box ref={ref} sx={{ position: 'relative', minWidth: 0, opacity: isDragSource ? 0.5 : 1 }}>
      <IconButton
        ref={handleRef}
        aria-label={`Drag ${label}`}
        size="small"
        disabled={disabled}
        sx={{
          position: 'absolute',
          top: 5,
          left: 5,
          zIndex: 2,
          touchAction: 'none',
          cursor: 'grab',
          display: disabled ? 'none' : undefined,
          bgcolor: 'background.paper',
        }}
      >
        <DragIndicator fontSize="small" />
      </IconButton>
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
      ref={ref}
      sx={{
        position: 'relative',
        outline: isDragSource ? '2px dashed' : undefined,
        outlineColor: 'primary.main',
        minWidth: 0,
      }}
    >
      <IconButton
        ref={handleRef}
        aria-label={`Reorder ${label}`}
        size="small"
        disabled={disabled}
        sx={{
          position: 'absolute',
          top: 5,
          left: 5,
          zIndex: 2,
          touchAction: 'none',
          cursor: 'grab',
          display: disabled ? 'none' : undefined,
        }}
      >
        <DragIndicator fontSize="small" />
      </IconButton>
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
    disabled: !enabled,
    collisionPriority: CollisionPriority.Low,
  })
  return (
    <Box
      ref={ref}
      role="region"
      aria-label={label}
      sx={{
        borderRadius: 2,
        outline: isDropTarget ? '3px solid' : undefined,
        outlineColor: 'primary.main',
        minHeight: 60,
      }}
    >
      {children}
    </Box>
  )
}

function BoardCover({ board }: { board: ApiBoardSummary }) {
  const [state, setState] = useState<{ id: number; items: ApiInuksuk[] } | null>(null)
  const key = `${board.id}:${board.version}`
  useEffect(() => {
    let active = true
    void fetchInuksuks({ board_id: board.id, limit: 4 }).then(
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
  const items =
    state?.id === board.id ? state.items.filter((item) => item.thumb != null).slice(0, 4) : []
  return (
    <Box
      sx={{
        height: 68,
        bgcolor: 'action.hover',
        display: 'grid',
        gridTemplateColumns: items.length > 1 ? '1fr 1fr' : '1fr',
        gap: '2px',
        overflow: 'hidden',
      }}
    >
      {items.length ? (
        items.map((item) => (
          <RenewingThumbnail
            key={item.id}
            image={{ id: item.id, thumb: item.thumb ?? '' }}
            renewThumb={fetchInuksuk}
            alt=""
            sx={{ width: '100%', height: '100%', minHeight: 0, objectFit: 'cover' }}
          />
        ))
      ) : board.cover_thumb ? (
        <RenewingThumbnail
          image={{ id: board.id, thumb: board.cover_thumb }}
          renewThumb={async (id) => {
            const fresh = await fetchBoard(id)
            return { id, thumb: fresh.cover_thumb }
          }}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <SpaceDashboardOutlined sx={{ m: 'auto', fontSize: 48, color: 'text.secondary' }} />
      )}
    </Box>
  )
}

async function saveToBoard(item: ApiInuksuk, targetId: number, sourceId: number | null) {
  const fresh = await fetchInuksuk(item.id)
  const boards = await Promise.all(fresh.board_ids.map((fetchBoardId) => fetchBoard(fetchBoardId)))
  const assignments: BoardAssignment[] = []
  for (const board of boards) {
    if (!board.permissions.can_edit || board.id === sourceId || board.id === targetId) continue
    const link = board.inuksuks.find((member) => member.id === fresh.id)
    if (!link) throw new Error('Board membership changed. Reload before saving.')
    assignments.push({
      board_id: board.id,
      sort_order: link.sort_order,
    })
  }
  assignments.push({ board_id: targetId })
  await updateInuksuk(fresh.id, { version: fresh.version, board_assignments: assignments })
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
  item: ApiInuksuk
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
  onOpenInuksuk,
}: BoardsPageProps) {
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<{ boardId: number | null; ids: number[] }>({
    boardId,
    ids: [],
  })
  const selectedIds = selection.boardId === boardId ? selection.ids : []
  const [collectionSource, setCollectionSource] = useState<{
    sources: CollectionSources
    items: ApiInuksuk[]
    type: CollectionType
    add: boolean
  } | null>(null)
  const editableCollections = useEditableCollections(
    enabled && collectionsEnabled && collectionSource != null,
  )
  const beginCollection = (
    items: ApiInuksuk[],
    type: CollectionType,
    add = false,
    sources: CollectionSources = { inuksuk_ids: items.map((item) => item.id) },
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
  const [notice, setNotice] = useState<string | null>(null)
  const [boardMenu, setBoardMenu] = useState<HTMLElement | null>(null)
  const [favourites, setFavourites] = useState(false)
  const data = useBoardsData(boardId, favourites, enabled)
  const board = data.board
  const [edit, setEdit] = useState<'new' | 'edit' | null>(null)
  const [owners, setOwners] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; item: ApiInuksuk } | null>(null)
  const [savingItem, setSavingItem] = useState<ApiInuksuk | null>(null)
  const [removingItem, setRemovingItem] = useState<ApiInuksuk | null>(null)
  const [editingItem, setEditingItem] = useState<ApiInuksuk | null>(null)
  const [activeItem, setActiveItem] = useState<ApiInuksuk | null>(null)
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
    setDeleting(false)
    setMenu(null)
    setSavingItem(null)
    setRemovingItem(null)
    setEditingItem(null)
    setBoardMenu(null)
    setBusy(false)
    setError(null)
    setConflict(false)
  }
  const own = data.boards.filter((row) => ownsBoard(row, currentUser))
  const reorderableBoards = own.filter((row) => row.permissions.can_edit)
  const needle = query.trim().toLocaleLowerCase()
  const ownerMatches = (item: ApiBoardSummary | ApiInuksuk) =>
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
      (!needle || `${item.title} ${item.description ?? ''}`.toLocaleLowerCase().includes(needle)) &&
      (!scopes.length || item.board_ids.some((id) => scopeIds.has(id))) &&
      ownerMatches(item) &&
      (!favourites || item.favourite),
  )
  const rows = [
    ...reorderableBoards,
    ...data.boards.filter((row) => !reorderableBoards.some((owned) => owned.id === row.id)),
  ].filter(
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
          ? 'This Board or Inuksuk changed. Reload the latest version before continuing.'
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
    if (event.canceled || !source || busy || conflict) return
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
      const item = (board?.inuksuks ?? data.recent).find((row) => `item:${row.id}` === source.id)
      if (!item) return
      const key = String(target.id)
      if (key.startsWith('save:') && item.permissions.can_edit) {
        const destination = data.boards.find((row) => row.id === Number(key.split(':')[1]))
        if (!destination?.permissions.can_edit || item.board_ids.includes(destination.id)) return
        void run(() => saveToBoard(item, destination.id, null)).then((ok) => {
          if (ok) setNotice(`Saved to ${destination.name}`)
        })
      } else if (board && canEdit) {
        const targetItem = board.inuksuks.find((row) => `item:${row.id}` === target.id)
        if (!targetItem) return
        const index = isSortable(source) ? source.index : board.inuksuks.indexOf(targetItem)
        void run(() =>
          reorderBoardInuksuks(board.id, {
            version: board.version,
            items: moveBoardMember(board, item.id, index),
          }),
        )
      }
    }
  }
  const memberCard = (item: ApiInuksuk, index: number, inBoard = false) => (
    <SortableFrame
      key={item.id}
      id={`${!inBoard && boardId != null ? 'backdrop' : 'item'}:${item.id}`}
      index={index}
      type="board-member"
      group="members"
      disabled={selecting || busy || conflict || (inBoard ? !canEdit : !item.permissions.can_edit)}
      sortable={inBoard}
      label={item.title}
    >
      <Card sx={{ mb: 2, breakInside: 'avoid', borderRadius: 3 }}>
        <CardActionArea
          onClick={() => (selecting ? toggleSelected(item.id) : onOpenInuksuk(item))}
          aria-label={`Open Inuksuk: ${item.title}`}
        >
          {item.thumb ? (
            <RenewingThumbnail
              image={{ id: item.id, thumb: item.thumb }}
              renewThumb={fetchInuksuk}
              alt=""
              sx={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
            />
          ) : (
            <Box
              sx={{
                aspectRatio: '4 / 3',
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
              }}
            >
              <CompassCalibration sx={{ fontSize: 48, color: 'text.secondary' }} />
            </Box>
          )}
          <CardContent sx={{ pb: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CompassCalibration fontSize="small" color="primary" />
              <Typography variant="subtitle1" component="p" fontWeight={600}>
                {item.title}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {item.category_name ?? 'Uncategorized'}
            </Typography>
            {item.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {item.description}
              </Typography>
            )}
          </CardContent>
        </CardActionArea>
        <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, pb: 0.5 }}>
          {selecting && (
            <Checkbox
              checked={selectedIds.includes(item.id)}
              onChange={() => toggleSelected(item.id)}
              inputProps={{ 'aria-label': `Select ${item.title}` }}
            />
          )}
          {item.permissions.can_edit ? (
            <IconButton
              aria-label={`Favourite ${item.title}`}
              aria-pressed={item.favourite}
              disabled={busy || conflict}
              onClick={() =>
                void run(() =>
                  updateInuksuk(item.id, { version: item.version, favourite: !item.favourite }),
                )
              }
            >
              {item.favourite ? <Favorite color="error" /> : <FavoriteBorder />}
            </IconButton>
          ) : (
            item.favourite && <Favorite color="error" sx={{ m: 1 }} />
          )}
          {(item.permissions.can_edit || board?.permissions.can_edit) && (
            <IconButton
              aria-label={`Actions for ${item.title}`}
              disabled={busy || conflict}
              onClick={(e) => {
                setError(null)
                setMenu({ anchor: e.currentTarget, item })
              }}
            >
              <MoreVert />
            </IconButton>
          )}
        </Stack>
      </Card>
    </SortableFrame>
  )

  const collageToolbar = (title: string) => (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        {collectionsEnabled && (
          <Button
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting)
              setSelection({ boardId, ids: [] })
            }}
          >
            {selecting ? 'Cancel selection' : 'Select'}
          </Button>
        )}
      </Stack>
      {collectionsEnabled && selecting && (
        <Stack
          role="toolbar"
          aria-label="Selected Inuksuks"
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
        >
          <Typography sx={{ alignSelf: 'center' }}>{selectedIds.length} selected</Typography>
          {(['sequence', 'synchronized'] as const).map((type) => {
            const items = (board ? board.inuksuks : filteredItems).filter((item) =>
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
    <Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 1500, mx: 'auto' }}>
      <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
        Boards &amp; Inuksuks
      </Typography>
      {boardId != null && !board && (
        <Button onClick={() => onSelectBoard(null)}>All Inuksuks</Button>
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
            (board?.inuksuks ?? data.recent).find((item) => `item:${item.id}` === id) ?? null,
          )
        }}
        onDragEnd={dragEnd}
      >
        <FilterBar
          ariaLabel="Filter Boards and Inuksuks"
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
              ariaLabel="Filter Boards and Inuksuks by title"
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
        <Box
          role="region"
          aria-label="Boards"
          sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', py: 2, mb: 2 }}
        >
          <Card
            variant="outlined"
            sx={{ flex: '0 0 120px', borderStyle: 'dashed', borderRadius: 2 }}
          >
            <CardActionArea
              onClick={() => {
                setError(null)
                setEdit('new')
              }}
              sx={{
                height: '100%',
                minHeight: 104,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <Add />
              <Typography variant="body2">New Board</Typography>
            </CardActionArea>
          </Card>
          {rows.map((row) => (
            <Box key={row.id} sx={{ flex: '0 0 156px', minWidth: 0 }}>
              <SortableFrame
                id={`board:${row.id}`}
                index={reorderableBoards.findIndex((b) => b.id === row.id)}
                type="board-card"
                group="boards"
                disabled={filtered || !reorderableBoards.some((b) => b.id === row.id)}
                label={row.name}
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
                    >
                      <Typography
                        variant="body2"
                        component="p"
                        noWrap
                        fontWeight={600}
                        sx={{
                          px: 1,
                          py: 0.75,
                          pl: reorderableBoards.some((b) => b.id === row.id) && !filtered ? 4 : 1,
                        }}
                        title={row.name}
                      >
                        {row.name}
                      </Typography>
                      <BoardCover board={row} />
                    </CardActionArea>
                  </Card>
                </DropArea>
              </SortableFrame>
            </Box>
          ))}
        </Box>
        {data.loading && <CircularProgress aria-label="Loading Boards" size={24} />}
        {!data.loading && (!data.error || data.boards.length > 0 || data.recent.length > 0) && (
          <>
            {!boardId && collageToolbar('Inuksuks')}
            <Box sx={{ columns: { xs: '1', sm: '2', md: '3', lg: '4' }, columnGap: 2 }}>
              {filteredItems.map((item, index) => memberCard(item, index))}
            </Box>
            {!filteredItems.length && (
              <Typography color="text.secondary">
                {filtered
                  ? 'No matching Inuksuks.'
                  : 'No Inuksuks yet. Save a view from an image to start your collection.'}
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
                  variant="h5"
                  sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {board?.name ?? 'Board'}
                </Typography>
                {board?.permissions.can_edit && (
                  <IconButton
                    aria-label="Edit Board"
                    disabled={busy || conflict}
                    onClick={() => setEdit('edit')}
                  >
                    <Edit />
                  </IconButton>
                )}
              </Box>
              <IconButton
                aria-label="Board options"
                onClick={(event) => setBoardMenu(event.currentTarget)}
              >
                <MoreVert />
              </IconButton>
              <IconButton aria-label="Close Board" onClick={() => onSelectBoard(null)}>
                <Close />
              </IconButton>
            </Stack>
            {board && (
              <>
                <Stack direction="row" alignItems="center" gap={1} sx={{ my: 1 }}>
                  <Chip
                    label={board.visibility[0].toUpperCase() + board.visibility.slice(1)}
                    size="small"
                    variant="outlined"
                  />
                  <Typography variant="body2" color="text.secondary">
                    {board.inuksuk_count} Inuksuks
                  </Typography>
                </Stack>
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
                <Box sx={{ columns: { xs: '1', sm: '2', md: '3', lg: '4' }, columnGap: 2 }}>
                  {board.inuksuks.map((item, index) => memberCard(item, index, true))}
                </Box>
                {!board.inuksuks.length && (
                  <Typography color="text.secondary">
                    No Inuksuks yet. Save a view from an image.
                  </Typography>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
        <Menu anchorEl={boardMenu} open={!!boardMenu} onClose={() => setBoardMenu(null)}>
          {board?.permissions.can_transfer && (
            <MenuItem
              disabled={busy || conflict}
              onClick={() => {
                setBoardMenu(null)
                setOwners(true)
              }}
            >
              Owners
            </MenuItem>
          )}
          {collectionsEnabled && board && (
            <MenuItem
              disabled={!board.inuksuks.length}
              onClick={() => {
                setBoardMenu(null)
                beginCollection(board.inuksuks, 'sequence', false, { source_board_id: board.id })
              }}
            >
              Create Sequence Collection
            </MenuItem>
          )}
          {board?.permissions.can_delete && (
            <MenuItem
              disabled={busy || conflict}
              onClick={() => {
                setBoardMenu(null)
                setError(null)
                setDeleting(true)
              }}
            >
              Delete Board
            </MenuItem>
          )}
        </Menu>
      </DragDropProvider>
      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice}
      />
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
        <InuksukFormDialog
          item={editingItem}
          imageId={editingItem.image_id}
          view={editingItem}
          userId={currentUser?.id}
          onClose={() => setEditingItem(null)}
          onChanged={data.reload}
        />
      )}
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu?.item.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              setSavingItem(menu.item)
              setMenu(null)
            }}
          >
            Move/Save to…
          </MenuItem>
        )}
        {menu?.item.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              setEditingItem(menu.item)
              setMenu(null)
            }}
          >
            Edit Inuksuk
          </MenuItem>
        )}
        {menu && board?.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              setRemovingItem(menu.item)
              setMenu(null)
            }}
          >
            Remove from this Board
          </MenuItem>
        )}
      </Menu>
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
      {deleting && board && (
        <Dialog open onClose={busy ? undefined : () => setDeleting(false)}>
          <DialogTitle>Delete Board?</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}Delete “{board.name}”? Its links will
            be removed. Inuksuks only on this Board will be permanently deleted.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              color="error"
              disabled={busy || conflict}
              onClick={() => {
                void run(() => deleteBoard(board.id, board.version)).then((ok) => {
                  if (ok) {
                    setDeleting(false)
                    onSelectBoard(null)
                  }
                })
              }}
            >
              Delete Board
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {removingItem && board && (
        <Dialog open onClose={busy ? undefined : () => setRemovingItem(null)}>
          <DialogTitle>Remove from this Board?</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}Remove “{removingItem.title}” from “
            {board.name}”? An Inuksuk must remain on at least one Board.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRemovingItem(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || conflict}
              onClick={() => {
                void run(() => removeBoardInuksuk(board.id, removingItem.id, board.version)).then(
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
