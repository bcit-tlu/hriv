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
  createBoardSection,
  deleteBoard,
  deleteBoardSection,
  fetchBoard,
  fetchInuksuk,
  fetchInuksuks,
  removeBoardInuksuk,
  reorderBoardInuksuks,
  reorderBoards,
  reorderBoardSections,
  updateBoardSection,
  updateInuksuk,
  userMessage,
} from '../api'
import { boardMemberOrder, moveBoardMember, ownsBoard } from '../boardUtils'
import type {
  ApiBoard,
  ApiBoardSection,
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
  enabled: boolean
  currentUser: User | null
  programs?: Program[]
  groups?: Group[]
  boardId: number | null
  sectionId?: number | null
  onSelectBoard: (boardId: number | null, sectionId?: number | null) => void
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

async function saveToBoard(
  item: ApiInuksuk,
  targetId: number,
  sectionId: number | null,
  sourceId: number | null,
) {
  const fresh = await fetchInuksuk(item.id)
  const boards = await Promise.all(fresh.board_ids.map((fetchBoardId) => fetchBoard(fetchBoardId)))
  const assignments: BoardAssignment[] = []
  for (const board of boards) {
    if (!board.permissions.can_edit || board.id === sourceId || board.id === targetId) continue
    const link = board.inuksuks.find((member) => member.id === fresh.id)
    if (!link) throw new Error('Board membership changed. Reload before saving.')
    assignments.push({
      board_id: board.id,
      section_id: link.section_id,
      sort_order: link.sort_order,
    })
  }
  assignments.push({ board_id: targetId, section_id: sectionId })
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
  onSave: (targetId: number, sectionId: number | null, move: boolean) => void
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
  const [sectionId, setSectionId] = useState<number | null>(null)
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
                  setSectionId(null)
                }}
                disabled={busy}
              >
                {options.map((board) => (
                  <MenuItem key={board.id} value={board.id}>
                    {board.name}
                  </MenuItem>
                ))}
              </TextField>
              {ready && (
                <TextField
                  select
                  label="Destination Section"
                  value={sectionId ?? ''}
                  onChange={(e) =>
                    setSectionId(e.target.value === '' ? null : Number(e.target.value))
                  }
                  disabled={busy}
                >
                  <MenuItem value="">Unsectioned</MenuItem>
                  {target.sections.map((section) => (
                    <MenuItem key={section.id} value={section.id}>
                      {section.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
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
          onClick={() => onSave(targetId, sectionId, move)}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BoardsPage({
  enabled,
  currentUser,
  programs = [],
  groups = [],
  boardId,
  sectionId = null,
  onSelectBoard,
  onOpenInuksuk,
}: BoardsPageProps) {
  const [shared, setShared] = useState(false)
  const [favourites, setFavourites] = useState(false)
  const data = useBoardsData(boardId, favourites, enabled)
  const board = data.board
  const [edit, setEdit] = useState<'new' | 'edit' | null>(null)
  const [owners, setOwners] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sectionAction, setSectionAction] = useState<{
    kind: 'create' | 'rename' | 'delete'
    section?: ApiBoardSection
  } | null>(null)
  const [sectionName, setSectionName] = useState('')
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
  const rows = shared ? data.boards.filter((row) => !ownsBoard(row, currentUser)) : own
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
    } else if (source.type === 'board-section' && board && canEdit) {
      const ids = resolveReorderedKeys(
        board.sections.map((row) => `section:${row.id}`),
        event,
      )
      if (ids)
        void run(() =>
          reorderBoardSections(board.id, {
            version: board.version,
            section_ids: ids.map((id) => Number(id.split(':')[1])),
          }),
        )
    } else if (source.type === 'board-member' && target && board && canEdit) {
      const item = board.inuksuks.find((row) => `item:${row.id}` === source.id)
      if (!item) return
      const targetKey = String(target.id)
      if (targetKey.startsWith('save:') && item.permissions.can_edit) {
        void run(() => saveToBoard(item, Number(targetKey.split(':')[1]), null, null))
      } else {
        const targetItem = board.inuksuks.find((row) => `item:${row.id}` === target.id)
        const destination = targetKey.startsWith('bin:')
          ? targetKey === 'bin:none'
            ? null
            : Number(targetKey.split(':')[1])
          : targetItem?.section_id
        if (destination === undefined) return
        const index = isSortable(source)
          ? source.index
          : board.inuksuks.filter((row) => row.section_id === destination).length
        void run(() =>
          reorderBoardInuksuks(board.id, {
            version: board.version,
            items: targetKey.startsWith('bin:')
              ? boardMemberOrder(board, [item.id], destination)
              : moveBoardMember(board, item.id, destination, index),
          }),
        )
      }
    }
  }
  const memberCard = (item: ApiInuksuk, index: number, section: string) => (
    <SortableFrame
      key={item.id}
      id={`item:${item.id}`}
      index={index}
      type="board-member"
      group={section}
      disabled={!canEdit || !board}
      label={item.title}
    >
      <Card sx={{ mb: 2, breakInside: 'avoid', borderRadius: 3 }}>
        <CardActionArea
          onClick={() => onOpenInuksuk(item)}
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
        <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', py: 2, mb: 2 }}>
          {rows.map((row) => (
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
                          <Typography variant="caption">{row.inuksuk_count} Inuksuks</Typography>
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </DropArea>
              </SortableFrame>
            </Box>
          ))}
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
        </Box>
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
              {board.permissions.can_edit && (
                <Button
                  startIcon={<Add />}
                  disabled={busy || conflict}
                  onClick={() => {
                    setSectionName('')
                    setSectionAction({ kind: 'create' })
                  }}
                >
                  New Section
                </Button>
              )}
            </Stack>
            {board.description && (
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {board.description}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
              <Chip
                label="All Sections"
                color={sectionId == null ? 'primary' : 'default'}
                onClick={() => onSelectBoard(board.id)}
              />
              {board.sections.map((section) => (
                <Chip
                  key={section.id}
                  label={section.name}
                  color={sectionId === section.id ? 'primary' : 'default'}
                  onClick={() => onSelectBoard(board.id, section.id)}
                />
              ))}
            </Stack>
            {sectionId != null && !board.sections.some((section) => section.id === sectionId) && (
              <Alert severity="info">This Section no longer exists. Choose All Sections.</Alert>
            )}
            {[...board.sections, { id: null, name: 'Unsectioned' }]
              .filter((section) => sectionId == null || section.id === sectionId)
              .map((section, index) => (
                <SortableFrame
                  key={section.id ?? 'none'}
                  id={`section:${section.id}`}
                  index={index}
                  type="board-section"
                  group="sections"
                  disabled={!canEdit || section.id == null || sectionId != null}
                  label={section.name}
                >
                  <Box
                    component="section"
                    aria-label={section.name}
                    sx={{
                      mb: 3,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 3,
                      p: 2,
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ mb: 1, pl: canEdit && section.id != null ? 3 : 0 }}
                    >
                      <Typography variant="h6" component="h3">
                        {section.name}
                      </Typography>
                      {canEdit && section.id != null && (
                        <>
                          <Button
                            size="small"
                            onClick={() => {
                              const found = board.sections.find((value) => value.id === section.id)
                              setSectionName(section.name)
                              setSectionAction({ kind: 'rename', section: found })
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            sx={{
                              color: (theme) =>
                                theme.palette.mode === 'dark'
                                  ? theme.palette.error.light
                                  : theme.palette.error.dark,
                            }}
                            onClick={() =>
                              setSectionAction({
                                kind: 'delete',
                                section: board.sections.find((value) => value.id === section.id),
                              })
                            }
                          >
                            Delete Section
                          </Button>
                        </>
                      )}
                    </Stack>
                    <DropArea
                      id={`bin:${section.id ?? 'none'}`}
                      label={`Move to section ${section.name}`}
                      enabled={canEdit}
                    >
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
                          gap: 2,
                        }}
                      >
                        {board.inuksuks
                          .filter((item) => item.section_id === section.id)
                          .map((item, memberIndex) =>
                            memberCard(item, memberIndex, `members:${section.id}`),
                          )}
                      </Box>
                      {!board.inuksuks.some((item) => item.section_id === section.id) && (
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          No Inuksuks yet. Drop one here or save a view from an image.
                        </Typography>
                      )}
                    </DropArea>
                  </Box>
                </SortableFrame>
              ))}
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
                {data.recent.map((item, index) => memberCard(item, index, 'recent'))}
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
        {menu &&
          canEdit &&
          [{ id: null, name: 'Unsectioned' }, ...board.sections].map((section) => (
            <MenuItem
              key={section.id ?? 'none'}
              onClick={() => {
                const item = menu.item
                setMenu(null)
                void run(() =>
                  reorderBoardInuksuks(board.id, {
                    version: board.version,
                    items: boardMemberOrder(board, [item.id], section.id),
                  }),
                )
              }}
            >
              Move to {section.name}
            </MenuItem>
          ))}
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
          onSave={(targetId, section, move) => {
            void run(() => saveToBoard(savingItem, targetId, section, move ? boardId : null)).then(
              (ok) => {
                if (ok) setSavingItem(null)
              },
            )
          }}
        />
      )}
      {deleting && board && (
        <Dialog open onClose={busy ? undefined : () => setDeleting(false)}>
          <DialogTitle>Delete Board?</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}Delete “{board.name}”? Its Sections
            and links will be removed. Inuksuks only on this Board will be permanently deleted.
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
      {sectionAction && board && (
        <Dialog
          open
          onClose={busy ? undefined : () => setSectionAction(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>
            {sectionAction.kind === 'delete'
              ? 'Delete Section?'
              : sectionAction.kind === 'create'
                ? 'New Section'
                : 'Rename Section'}
          </DialogTitle>
          <DialogContent sx={{ pt: '12px !important' }}>
            {error && <Alert severity="error">{error}</Alert>}
            {sectionAction.kind === 'delete' ? (
              'Inuksuks in this Section will become Unsectioned; they will not be deleted.'
            ) : (
              <TextField
                label="Section name"
                autoFocus
                fullWidth
                required
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setSectionAction(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy || conflict || (sectionAction.kind !== 'delete' && !sectionName.trim())
              }
              onClick={() => {
                void run(async () => {
                  if (sectionAction.kind === 'create')
                    await createBoardSection(board.id, {
                      name: sectionName.trim(),
                      version: board.version,
                    })
                  else if (sectionAction.section && sectionAction.kind === 'rename')
                    await updateBoardSection(board.id, sectionAction.section.id, {
                      name: sectionName.trim(),
                      version: board.version,
                    })
                  else if (sectionAction.section)
                    await deleteBoardSection(board.id, sectionAction.section.id, board.version)
                }).then((ok) => {
                  if (ok) {
                    if (sectionAction.kind === 'delete' && sectionAction.section?.id === sectionId)
                      onSelectBoard(board.id)
                    setSectionAction(null)
                  }
                })
              }}
            >
              Confirm
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
