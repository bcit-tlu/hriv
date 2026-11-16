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
import { useEffect, useMemo, useState } from 'react'
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
  Tab,
  Tabs,
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
import { DragDropProvider, KeyboardSensor, PointerSensor, useDroppable } from '@dnd-kit/react'
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
}

function SortableFrame(props: SortableFrameProps) {
  return props.disabled ? (
    <Box sx={{ position: 'relative', minWidth: 0 }}>{props.children}</Box>
  ) : (
    <ActiveSortableFrame {...props} />
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
      {!disabled && (
        <IconButton
          ref={handleRef}
          aria-label={`Reorder ${label}`}
          size="small"
          sx={{
            position: 'absolute',
            top: 5,
            left: 5,
            zIndex: 2,
            touchAction: 'none',
            cursor: 'grab',
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
  const [state, setState] = useState<{ key: string; items: ApiInuksuk[] } | null>(null)
  const key = `${board.id}:${board.version}`
  useEffect(() => {
    let active = true
    void fetchInuksuks({ board_id: board.id, limit: 4 }).then(
      (items) => {
        if (active) setState({ key, items })
      },
      () => {
        if (active) setState({ key, items: [] })
      },
    )
    return () => {
      active = false
    }
  }, [board.id, key])
  const items =
    state?.key === key ? state.items.filter((item) => item.thumb != null).slice(0, 4) : []
  return (
    <Box
      sx={{
        height: 144,
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
  const [shared, setShared] = useState(false)
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
  const own = data.boards.filter((row) => ownsBoard(row, currentUser))
  const reorderableBoards = own.filter((row) => row.permissions.can_edit)
  const readOnlyBoards = own.filter((row) => !row.permissions.can_edit)
  const rows = shared
    ? data.boards.filter((row) => !ownsBoard(row, currentUser))
    : reorderableBoards
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
      await data.reload()
      return true
    } catch (err) {
      const stale = err instanceof ApiError && err.status === 409
      setConflict(stale)
      setError(
        stale
          ? 'This Board or Inuksuk changed. Reload the latest version before continuing.'
          : userMessage(err, 'Unable to save changes.'),
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  const dragEnd = (event: DragEndEvent) => {
    const { source, target } = event.operation
    setActiveItem(null)
    if (event.canceled || !source || busy || conflict) return
    if (source.type === 'board-card' && !shared) {
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
    } else if (source.type === 'board-member' && target && board && canEdit) {
      const item = board.inuksuks.find((row) => `item:${row.id}` === source.id)
      if (!item) return
      const targetKey = String(target.id)
      if (targetKey.startsWith('save:') && item.permissions.can_edit) {
        void run(() => saveToBoard(item, Number(targetKey.split(':')[1]), null))
      } else {
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
  const memberCard = (item: ApiInuksuk, index: number) => (
    <SortableFrame
      key={item.id}
      id={`item:${item.id}`}
      index={index}
      type="board-member"
      group="members"
      disabled={selecting || !canEdit || !board}
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
              sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
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
      {collectionsEnabled && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          <Button
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting)
              setSelection({ boardId, ids: [] })
            }}
          >
            {selecting ? 'Cancel selection' : 'Select'}
          </Button>
          {selecting && (
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
                const items = (board ? board.inuksuks : data.recent).filter((item) =>
                  selectedIds.includes(item.id),
                )
                const valid =
                  items.length > 0 &&
                  (type === 'sequence' || (items.length >= 2 && items.length <= 4))
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
        </Stack>
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
            setError(userMessage(err, 'Unable to add saved views.'))
            return false
          }
        }}
      />
      <DragDropProvider
        sensors={sensors}
        onDragStart={(event) => {
          const id = event.operation.source?.id
          setActiveItem(board?.inuksuks.find((item) => `item:${item.id}` === id) ?? null)
        }}
        onDragEnd={dragEnd}
      >
        <Tabs
          value={shared ? 'shared' : 'own'}
          onChange={(_, value) => setShared(value === 'shared')}
          aria-label="Board ownership"
        >
          <Tab label="Your Boards" value="own" />
          <Tab label="Shared with me / Public" value="shared" />
        </Tabs>
        {[
          { id: 'main', boards: rows, readOnly: false },
          ...(!shared && readOnlyBoards.length
            ? [{ id: 'read-only', boards: readOnlyBoards, readOnly: true }]
            : []),
        ].map((group) => (
          <Box
            key={group.id}
            role="region"
            aria-label={
              group.readOnly
                ? 'Read-only owned Boards'
                : shared
                  ? 'Shared Boards'
                  : 'Editable owned Boards'
            }
          >
            {group.readOnly && (
              <Typography variant="h6" component="h2">
                Read-only Boards
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', py: 2, mb: 2 }}>
              {group.boards.map((row) => (
                <Box key={row.id} sx={{ flex: '0 0 220px' }}>
                  <SortableFrame
                    id={`board:${row.id}`}
                    index={reorderableBoards.findIndex((candidate) => candidate.id === row.id)}
                    type="board-card"
                    group="boards"
                    disabled={shared || !row.permissions.can_edit}
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
                          borderRadius: 3,
                          borderColor: row.id === boardId ? 'primary.main' : 'divider',
                          borderWidth: row.id === boardId ? 2 : 1,
                        }}
                      >
                        <CardActionArea
                          onClick={() => onSelectBoard(row.id)}
                          aria-label={`Open Board: ${row.name}`}
                        >
                          <BoardCover board={row} />
                          <CardContent>
                            <Typography variant="subtitle1" component="p" noWrap fontWeight={600}>
                              {row.name}
                            </Typography>
                            <Stack
                              direction="row"
                              alignItems="center"
                              justifyContent="space-between"
                              sx={{ mt: 1 }}
                            >
                              <Chip label={row.visibility} size="small" variant="outlined" />
                              <Typography variant="caption">
                                {row.inuksuk_count} Inuksuks
                              </Typography>
                            </Stack>
                          </CardContent>
                        </CardActionArea>
                      </Card>
                    </DropArea>
                  </SortableFrame>
                </Box>
              ))}
              {!group.readOnly && (
                <Card
                  variant="outlined"
                  sx={{ flex: '0 0 160px', minHeight: 230, borderStyle: 'dashed', borderRadius: 3 }}
                >
                  <CardActionArea
                    onClick={() => {
                      setError(null)
                      setEdit('new')
                    }}
                    sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}
                  >
                    <Add fontSize="large" />
                    <Typography>New Board</Typography>
                  </CardActionArea>
                </Card>
              )}
            </Box>
          </Box>
        ))}
        {data.loading && <CircularProgress aria-label="Loading Boards" size={24} />}
        {board ? (
          <>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ mb: 2 }}
            >
              <Button onClick={() => onSelectBoard(null)}>All Inuksuks</Button>
              <Typography variant="h5" component="h2">
                {board.name}
              </Typography>
              <Chip label={board.visibility} size="small" />
              {board.permissions.can_edit && (
                <Button disabled={busy || conflict} onClick={() => setEdit('edit')}>
                  Edit Board
                </Button>
              )}
              {collectionsEnabled && (
                <Button
                  disabled={!board.inuksuks.length}
                  onClick={() =>
                    beginCollection(board.inuksuks, 'sequence', false, {
                      source_board_id: board.id,
                    })
                  }
                >
                  Create Sequence Collection
                </Button>
              )}
              {board.permissions.can_transfer && (
                <Button disabled={busy || conflict} onClick={() => setOwners(true)}>
                  Owners
                </Button>
              )}
              {board.permissions.can_delete && (
                <Button
                  color="error"
                  sx={{
                    color: (theme) =>
                      theme.palette.mode === 'dark'
                        ? theme.palette.error.light
                        : theme.palette.error.dark,
                  }}
                  disabled={busy || conflict}
                  onClick={() => {
                    setError(null)
                    setDeleting(true)
                  }}
                >
                  Delete Board
                </Button>
              )}
            </Stack>
            {board.description && (
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {board.description}
              </Typography>
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
                gap: 2,
              }}
            >
              {board.inuksuks.map((item, index) => memberCard(item, index))}
            </Box>
            {board.inuksuks.length === 0 && (
              <Typography color="text.secondary" sx={{ py: 2 }}>
                No Inuksuks yet. Save a view from an image.
              </Typography>
            )}
          </>
        ) : (
          !data.loading &&
          !data.error && (
            <>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 2 }}
              >
                <Typography variant="h5" component="h2">
                  {favourites ? 'Favourite Inuksuks' : 'Recent Inuksuks'}
                </Typography>
                <FormControlLabel
                  label="Favourites only"
                  control={
                    <Switch
                      checked={favourites}
                      onChange={(e) => setFavourites(e.target.checked)}
                    />
                  }
                />
              </Stack>
              <Box sx={{ columns: { xs: '1', sm: '2', md: '3', lg: '4' }, columnGap: 2 }}>
                {data.recent.map((item, index) => memberCard(item, index))}
              </Box>
              {!data.recent.length && (
                <Typography color="text.secondary">
                  {favourites
                    ? 'No favourites yet.'
                    : 'No Inuksuks yet. Save a view from an image to start your collection.'}
                </Typography>
              )}
              {data.recent.length === 60 && (
                <Typography variant="caption">
                  Showing the 60 most recently updated Inuksuks. Open a Board to see all its saved
                  views.
                </Typography>
              )}
            </>
          )
        )}
      </DragDropProvider>
      {edit && (edit === 'new' || board) && (
        <BoardEditDialog
          board={edit === 'edit' ? board : null}
          programs={programs}
          groups={groups}
          onClose={() => setEdit(null)}
          onSaved={(saved) => {
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
