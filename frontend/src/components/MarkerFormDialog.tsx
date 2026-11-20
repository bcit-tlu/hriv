import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isSubmitKey, useInitialFocus } from '../formKeys'
import { createPortal } from 'react-dom'
import { markerAccentColor, markerFavouriteButtonSx } from '../theme'
import Paper from '@mui/material/Paper'
import { markerPanelSx } from './markerPanelStyles'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Slide from '@mui/material/Slide'
import Tooltip from '@mui/material/Tooltip'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import Add from '@mui/icons-material/Add'
import ArrowDropDown from '@mui/icons-material/ArrowDropDown'
import CheckCircle from '@mui/icons-material/CheckCircle'
import Close from '@mui/icons-material/Close'
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked'
import ArrowBack from '@mui/icons-material/ArrowBack'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Room from '@mui/icons-material/Room'
import * as api from '../api'
import { apiGroupToGroup } from '../groupUtils'
import { BoardFields } from './BoardEditDialog'
import BoardCover from './BoardCover'
import type {
  ApiBoard,
  ApiBoardSummary,
  ApiMarker,
  BoardAssignment,
  BoardVisibility,
  Group,
  MarkerView,
  Program,
} from '../types'

const defaultServices = {
  fetchBoards: api.fetchBoards,
  fetchBoard: api.fetchBoard,
  createBoard: api.createBoard,
  fetchPrograms: api.fetchPrograms,
  fetchGroups: api.fetchGroups,
  createMarker: api.createMarker,
  updateMarker: api.updateMarker,
  deleteMarker: api.deleteMarker,
}
const formSx = {
  '& .MuiInputBase-root, & .MuiInputLabel-root': { typography: 'body2' },
}
export interface MarkerFormDialogProps {
  imageId: number
  view: MarkerView
  item?: ApiMarker | null
  userId?: number
  container?: HTMLElement | null
  onClose: () => void
  onChanged: (created?: ApiMarker) => Promise<void> | void
  services?: typeof defaultServices
  placement?: boolean
  onTitleChange?: (title: string) => void
  onRemoveFromBoard?: () => void
  onViewMarker?: () => void
  inline?: boolean
  onEscape?: () => void
}
const RECENT_BOARDS_LIMIT = 50
const SEARCH_THRESHOLD = 8
function recentKey(userId: number) {
  return `hrivpref:marker:recentBoards:${userId}`
}
/** Most-recently-used Board IDs, newest first. Falls back to the single
 *  `lastBoard` key written by earlier releases. */
function recentBoards(userId: number | undefined): number[] {
  try {
    if (userId == null) return []
    const raw = localStorage.getItem(recentKey(userId))
    if (raw == null) {
      const id = Number(localStorage.getItem(`hrivpref:marker:lastBoard:${userId}`))
      return Number.isSafeInteger(id) && id > 0 ? [id] : []
    }
    const ids: unknown = JSON.parse(raw)
    return Array.isArray(ids)
      ? ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      : []
  } catch {
    return []
  }
}
function rememberBoards(userId: number, ids: number[]) {
  try {
    const next = [...ids, ...recentBoards(userId).filter((id) => !ids.includes(id))]
    localStorage.setItem(recentKey(userId), JSON.stringify(next.slice(0, RECENT_BOARDS_LIMIT)))
  } catch {
    /* Storage is optional. */
  }
}
function byName(a: ApiBoardSummary, b: ApiBoardSummary) {
  return a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id - b.id
}
/** Chip order: selected Boards, then recently used, then the rest by name. */
function orderBoards(boards: ApiBoardSummary[], selected: number[], recents: number[]) {
  const rank = (board: ApiBoardSummary) => {
    const recent = recents.indexOf(board.id)
    return recent < 0 ? recents.length : recent
  }
  return [...boards]
    .sort(
      (a, b) =>
        Number(!selected.includes(a.id)) - Number(!selected.includes(b.id)) ||
        rank(a) - rank(b) ||
        byName(a, b),
    )
    .map((board) => board.id)
}

/** Wrapping Board toggle chips capped at six rows; the overflow is reachable
 *  through "…more", and "+ New Board" always ends the group. */
/** "Save to" picker: every editable Board as a row with its cover, toggled
 *  with a checkmark, plus Create Board. Shared by the Save split button and
 *  the edit form's "Save to another Board". */
function BoardPicker({
  anchorEl,
  boards,
  selectedIds,
  container,
  onToggle,
  onCreate,
  onClose,
}: {
  anchorEl: HTMLElement
  boards: ApiBoardSummary[]
  selectedIds: Set<number>
  container?: HTMLElement | null
  onToggle: (board: ApiBoardSummary) => void
  onCreate: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const [query, setQuery] = useState('')
  // Pinned where it opened: the anchor moves as Board rows are added or the
  // empty slot becomes a link, and following it would make the picker jump.
  const [position] = useState(() => {
    const rect = anchorEl.getBoundingClientRect()
    return { top: rect.bottom, left: rect.right }
  })
  const searchable = boards.length > SEARCH_THRESHOLD
  const needle = query.trim().toLocaleLowerCase()
  const matching = needle
    ? boards.filter((board) => board.name.toLocaleLowerCase().includes(needle))
    : boards
  return (
    <Popover
      open
      anchorReference="anchorPosition"
      anchorPosition={position}
      container={container}
      data-hriv-canvas-ui
      onClose={onClose}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': titleId,
          sx: {
            width: 320,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(440px, calc(100vh - 64px))',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Typography id={titleId} variant="subtitle2" component="h2" sx={{ px: 2, pt: 1.5, pb: 1 }}>
        Save to
      </Typography>
      {searchable && (
        <TextField
          label="Search Boards"
          size="small"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mx: 2, mb: 1, flexShrink: 0 }}
        />
      )}
      <List dense disablePadding component="div" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {matching.map((board) => {
          const selected = selectedIds.has(board.id)
          return (
            <ListItemButton
              key={board.id}
              data-board-id={board.id}
              selected={selected}
              aria-pressed={selected}
              autoFocus={!searchable && board === matching[0]}
              onClick={() => onToggle(board)}
              sx={{ gap: 1.5, py: 0.5 }}
            >
              <BoardCover board={board} size={36} radius={1} />
              <ListItemText
                primary={board.name}
                secondary={`${board.marker_count} ${board.marker_count === 1 ? 'Marker' : 'Markers'}`}
                slotProps={{ primary: { noWrap: true } }}
                sx={{ minWidth: 0 }}
              />
              {selected ? (
                <CheckCircle color="primary" fontSize="small" />
              ) : (
                <RadioButtonUnchecked fontSize="small" sx={{ color: 'action.disabled' }} />
              )}
            </ListItemButton>
          )
        })}
        {matching.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {boards.length ? 'No matching Boards.' : 'You have no Boards you can edit yet.'}
          </Typography>
        )}
      </List>
      <Divider />
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, flexShrink: 0 }}>
        <Button size="small" startIcon={<Add />} onClick={onCreate}>
          Create Board
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose}>
          Done
        </Button>
      </Box>
    </Popover>
  )
}

export function MarkerDeleteDialog({
  title,
  container,
  busy = false,
  confirmDisabled = false,
  error,
  onCancel,
  onConfirm,
}: {
  title: string
  container?: HTMLElement | null
  busy?: boolean
  confirmDisabled?: boolean
  error?: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  return (
    <Dialog
      open
      container={container}
      data-hriv-canvas-ui
      aria-labelledby={titleId}
      onClose={busy ? undefined : onCancel}
    >
      <DialogTitle id={titleId}>Delete Marker?</DialogTitle>
      <DialogContent>
        {error}
        <Typography>
          “{title}” will be permanently deleted from all its Boards. This cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          color="error"
          variant="contained"
          disabled={busy || confirmDisabled}
          onClick={onConfirm}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function MarkerFormDialog({
  onRemoveFromBoard,
  onViewMarker,
  imageId,
  view,
  item = null,
  userId,
  container,
  onClose,
  onChanged,
  services = defaultServices,
  placement = false,
  onTitleChange,
  inline = false,
  onEscape,
}: MarkerFormDialogProps) {
  const [baseline, setBaseline] = useState<api.MarkerConflict | null>(item)
  const [title, setTitle] = useState(item?.title ?? (placement ? 'New Marker' : ''))
  const [description, setDescription] = useState(item?.description ?? '')
  const [favourite, setFavourite] = useState(item?.favourite ?? false)
  const [boards, setBoards] = useState<ApiBoardSummary[]>([])
  const [details, setDetails] = useState<Record<number, ApiBoard>>({})
  const [assignments, setAssignments] = useState<BoardAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [boardsLoaded, setBoardsLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<api.MarkerConflict | null>(null)
  const [boardPane, setBoardPane] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [boardDescription, setBoardDescription] = useState('')
  const [boardVisibility, setBoardVisibility] = useState<BoardVisibility>('private')
  const [boardProgramIds, setBoardProgramIds] = useState<number[]>([])
  const [boardGroupIds, setBoardGroupIds] = useState<number[]>([])
  const [boardScope, setBoardScope] = useState<{ programs: Program[]; groups: Group[] } | null>(
    null,
  )
  const [boardBusy, setBoardBusy] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [boardOrder, setBoardOrder] = useState<number[]>([])
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const formTitleId = useId()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const panesRef = useRef<HTMLDivElement>(null)
  const [panesEl, setPanesEl] = useState<HTMLDivElement | null>(null)
  const setPanesRef = useCallback((el: HTMLDivElement | null) => {
    panesRef.current = el
    setPanesEl(el)
  }, [])
  const boardsButtonRef = useRef<HTMLButtonElement>(null)
  const savedToId = useId()
  const titleRef = useRef<HTMLInputElement>(null)
  const editable = !baseline || baseline.permissions.can_edit

  const closeBoardPane = useCallback(() => {
    setBoardPane(false)
    requestAnimationFrame(() => boardsButtonRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!inline) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmDelete || pickerAnchor) return
      event.stopPropagation()
      if (boardPane) {
        closeBoardPane()
        return
      }
      if (!busy) (onEscape ?? onClose)()
    }
    const document = container?.ownerDocument ?? window.document
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [
    inline,
    busy,
    container,
    onClose,
    onEscape,
    confirmDelete,
    pickerAnchor,
    boardPane,
    closeBoardPane,
  ])

  useEffect(() => {
    let cancelled = false
    services
      .fetchBoards()
      .then(async (rows) => {
        const editableBoards = rows.filter((board) => board.permissions.can_edit)
        const recents = recentBoards(userId)
        const remembered = recents.find((id) => editableBoards.some((board) => board.id === id))
        const ids = baseline?.board_ids ?? (remembered == null ? [] : [remembered])
        const selected = editableBoards.filter((board) => ids.includes(board.id))
        const loaded = await Promise.all(selected.map((board) => services.fetchBoard(board.id)))
        if (cancelled) return
        setBoards(editableBoards)
        setBoardOrder(orderBoards(editableBoards, ids, recents))
        setDetails(Object.fromEntries(loaded.map((board) => [board.id, board])))
        setAssignments(
          loaded.map((board) => ({
            board_id: board.id,
          })),
        )
        setLoading(false)
        setBoardsLoaded(true)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(api.userMessage(err, 'Unable to load Boards.'))
          setLoading(false)
          setBoardsLoaded(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [services, userId, baseline])

  const toggleBoard = (board: ApiBoardSummary) => {
    if (assignments.some((link) => link.board_id === board.id)) {
      setAssignments(assignments.filter((link) => link.board_id !== board.id))
      return
    }
    setAssignments([...assignments, { board_id: board.id }])
    if (details[board.id]) return
    services
      .fetchBoard(board.id)
      .then((value) => setDetails((previous) => ({ ...previous, [value.id]: value })))
      .catch((err) => setError(api.userMessage(err, 'Unable to load this Board.')))
  }
  const openBoardPane = useCallback(() => {
    setBoardName('')
    setBoardDescription('')
    setBoardVisibility('private')
    setBoardProgramIds([])
    setBoardGroupIds([])
    setBoardError(null)
    setBoardPane(true)
    panesRef.current?.parentElement?.scrollTo?.({ top: 0 })
  }, [])
  const saveNewBoard = async () => {
    setBoardBusy(true)
    setBoardError(null)
    try {
      const board = await services.createBoard({
        name: boardName.trim(),
        description: boardDescription.trim() || null,
        visibility: boardVisibility,
        program_ids: boardVisibility === 'restricted' ? boardProgramIds : [],
        group_ids: boardVisibility === 'restricted' ? boardGroupIds : [],
      })
      setBoards((previous) => [...previous, board])
      setBoardOrder((previous) => [board.id, ...previous])
      setDetails((previous) => ({ ...previous, [board.id]: board }))
      setAssignments((previous) => [...previous, { board_id: board.id }])
      setBoardPane(false)
      requestAnimationFrame(() => boardsButtonRef.current?.focus())
    } catch (err) {
      setBoardError(api.userMessage(err, 'Unable to create Board.'))
    } finally {
      setBoardBusy(false)
    }
  }
  // Restricted scope chips need Program/Group lists; fetch them lazily so
  // private/public creation never pays for them.
  useEffect(() => {
    if (!boardPane || boardVisibility !== 'restricted' || boardScope) return
    let cancelled = false
    Promise.all([services.fetchPrograms(), services.fetchGroups()]).then(
      ([programs, groups]) => {
        if (!cancelled) setBoardScope({ programs, groups: groups.map(apiGroupToGroup) })
      },
      (err) => {
        if (!cancelled) setBoardError(api.userMessage(err, 'Unable to load Programs and Groups.'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [boardPane, boardVisibility, boardScope, services])
  const persist = async (deleting = false) => {
    if (!deleting && baseline && !boardsLoaded) return
    setBusy(true)
    setError(null)
    try {
      let created: ApiMarker | undefined
      if (deleting && baseline) await services.deleteMarker(baseline.id, baseline.version)
      else {
        const values = {
          title: title.trim(),
          description: description.trim() || null,
          favourite,
          board_assignments: assignments,
        }
        if (baseline)
          await services.updateMarker(baseline.id, { ...values, version: baseline.version })
        else {
          const { x, y, zoom, rotation } = view
          created = await services.createMarker({
            x,
            y,
            zoom,
            rotation,
            ...values,
            image_id: imageId,
          })
        }
        if (userId != null && assignments.length)
          rememberBoards(userId, assignments.map((link) => link.board_id).reverse())
      }
      await onChanged(created)
      onClose()
    } catch (err) {
      setConflict(api.markerConflictCurrent(err))
      setError(
        err instanceof api.ApiError && err.status === 409
          ? 'This Marker changed since you opened it. Reload the current values before saving again.'
          : api.userMessage(err, deleting ? 'Unable to delete Marker.' : 'Unable to save Marker.'),
      )
    } finally {
      setBusy(false)
    }
  }
  const reloadConflict = () => {
    if (!conflict) return
    setBaseline(conflict)
    setTitle(conflict.title)
    setDescription(conflict.description ?? '')
    setFavourite(conflict.favourite)
    setConfirmDelete(false)
    setConflict(null)
    setError(null)
    setLoading(true)
  }
  const selectedIds = new Set(assignments.map((link) => link.board_id))
  const orderedBoards = boardOrder.flatMap((id) => boards.find((board) => board.id === id) ?? [])
  const selectedBoards = assignments.flatMap(
    (link) => boards.find((board) => board.id === link.board_id) ?? [],
  )
  const openPicker = () => setPickerAnchor(boardsButtonRef.current)
  const empty = !loading && assignments.length === 0
  const missingDetails = assignments.some((link) => !details[link.board_id])
  const canSave =
    editable &&
    !busy &&
    !loading &&
    !(baseline && !boardsLoaded) &&
    !missingDetails &&
    !conflict &&
    !!title.trim() &&
    assignments.length > 0
  const canCreateBoard =
    !boardBusy &&
    !!boardName.trim() &&
    !(boardVisibility === 'restricted' && boardProgramIds.length + boardGroupIds.length === 0)
  useInitialFocus(titleRef, editable && !busy)
  const errorAlert = error && (
    <Alert
      severity="error"
      action={
        conflict ? (
          <Button size="small" color="inherit" onClick={reloadConflict}>
            Reload current
          </Button>
        ) : undefined
      }
    >
      {error}
    </Alert>
  )
  // Compact chrome for the canvas popover and drawer-embedded variants;
  // the standalone dialog follows the Edit Image / Edit Collection layout.
  // The popover keeps the standard layout — same field order, visible
  // Description, delete section — with only slightly tighter spacing.
  const compact = inline || placement
  const content = (
    <>
      <DialogTitle
        component="div"
        variant={inline ? 'subtitle1' : 'h6'}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.5,
          ...(compact ? { px: inline ? 0 : 2, py: inline ? 0 : 1.5, mb: inline ? 1.5 : 0 } : {}),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          {compact && <Room sx={{ color: markerAccentColor }} />}
          <Typography
            id={formTitleId}
            component="h2"
            variant={inline ? 'subtitle1' : 'h6'}
            sx={
              baseline
                ? { overflowWrap: 'anywhere', minWidth: 0 }
                : { whiteSpace: 'nowrap', flexShrink: 0 }
            }
          >
            {inline
              ? baseline?.title
              : baseline
                ? editable
                  ? 'Edit Marker'
                  : 'Marker details'
                : 'Add Marker to'}
          </Typography>
          {editable && !baseline && (
            // The destination lives in the header, next to the Marker it
            // receives; Save stays a plain action.
            <Button
              ref={boardsButtonRef}
              size="small"
              color="inherit"
              endIcon={<ArrowDropDown />}
              aria-haspopup="dialog"
              disabled={busy || loading}
              onClick={openPicker}
              sx={{
                flex: '0 1 auto',
                minWidth: 0,
                px: 1,
                textTransform: 'none',
                typography: inline ? 'subtitle1' : 'h6',
                bgcolor: 'action.hover',
                '& .MuiButton-endIcon': { ml: 0 },
              }}
            >
              <Box
                component="span"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {selectedBoards.length === 1
                  ? selectedBoards[0].name
                  : selectedBoards.length > 1
                    ? `${selectedBoards.length} Boards`
                    : 'Choose a Board'}
              </Box>
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {editable && (
            <Tooltip title={favourite ? 'Remove favourite' : 'Add favourite'}>
              <IconButton
                size="small"
                aria-label="Favourite"
                aria-pressed={favourite}
                disabled={busy}
                onClick={() => setFavourite(!favourite)}
                sx={markerFavouriteButtonSx(favourite)}
              >
                {favourite ? (
                  <Star sx={{ color: 'common.white' }} fontSize="small" />
                ) : (
                  <StarBorder sx={{ color: 'common.white' }} fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
          {!inline && baseline && onViewMarker && (
            <Button size="small" variant="outlined" disabled={busy} onClick={onViewMarker}>
              View Marker
            </Button>
          )}
        </Box>
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: placement ? 1.5 : 2,
          pt: 2,
          // DialogContent zeroes its top padding after a DialogTitle, which
          // clips the outlined Title label.
          '.MuiDialogTitle-root + &': { pt: 2 },
          ...(compact ? { px: inline ? 0 : 2 } : {}),
        }}
        onKeyDown={(event) => {
          if (!canSave || !isSubmitKey(event)) return
          event.preventDefault()
          void persist()
        }}
      >
        {baseline && !loading && !boardsLoaded && (
          <Alert severity="error">
            Existing Board assignments could not be loaded. Close and reopen this dialog before
            saving changes.
          </Alert>
        )}
        {!confirmDelete && errorAlert}
        <TextField
          label="Title"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            onTitleChange?.(event.target.value)
          }}
          onFocus={(event) => {
            if (placement) event.target.select()
          }}
          disabled={busy || !editable}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          inputRef={titleRef}
        />
        <TextField
          label="Description"
          fullWidth
          multiline
          minRows={placement || inline ? 2 : 3}
          maxRows={10}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={busy || !editable}
        />
        {editable ? (
          baseline ? (
            <Box component="section" aria-labelledby={savedToId}>
              <Typography id={savedToId} variant="subtitle2" component="h3" sx={{ mb: 0.75 }}>
                Saved to
              </Typography>
              {loading ? (
                <Typography variant="body2" color="text.secondary">
                  Loading Boards…
                </Typography>
              ) : (
                <Stack spacing={0.5} role="list" aria-labelledby={savedToId}>
                  {selectedBoards.map((board) => (
                    <Box
                      key={board.id}
                      role="listitem"
                      data-board-id={board.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 0.5,
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                      }}
                    >
                      <BoardCover board={board} size={32} radius={0.5} />
                      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                        {board.name}
                      </Typography>
                      <Tooltip title={`Remove from ${board.name}`}>
                        <IconButton
                          size="small"
                          aria-label={`Remove from ${board.name}`}
                          disabled={busy}
                          onClick={() => toggleBoard(board)}
                        >
                          <Close fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Stack>
              )}
              {/* One element for both states keeps the open picker's anchor
                  attached when the first Board is chosen. */}
              <Button
                ref={boardsButtonRef}
                size={empty ? 'medium' : 'small'}
                fullWidth={empty}
                variant={empty ? 'outlined' : 'text'}
                startIcon={<Add />}
                aria-haspopup="dialog"
                disabled={busy || loading}
                onClick={openPicker}
                sx={
                  empty
                    ? { justifyContent: 'flex-start', minHeight: 42, borderStyle: 'dashed' }
                    : { mt: 0.5 }
                }
              >
                {empty ? 'Choose a Board' : 'Save to another Board'}
              </Button>
            </Box>
          ) : null
        ) : (
          <Typography variant="caption" component="p">
            Saved on {baseline?.board_ids.length} Board(s). Only its owners can edit this Marker.
          </Typography>
        )}
        {baseline?.permissions.can_delete && (
          <>
            <Divider />
            <Button
              size="small"
              color="error"
              variant="outlined"
              fullWidth
              disabled={busy || !!conflict}
              onClick={() => setConfirmDelete(true)}
            >
              Delete Marker
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions sx={inline ? { px: 0, py: 1 } : undefined}>
        {onRemoveFromBoard && (
          <Button
            size="small"
            color="error"
            disabled={busy || loading || !!conflict}
            onClick={onRemoveFromBoard}
          >
            Remove from this Board
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" disabled={busy} onClick={onClose}>
          {editable ? 'Cancel' : 'Close'}
        </Button>
        {editable && baseline && (
          <Button
            size="small"
            variant="contained"
            disabled={!canSave}
            onClick={() => void persist()}
          >
            {busy ? 'Saving…' : inline || placement ? 'Save' : 'Save changes'}
          </Button>
        )}
        {editable && !baseline && (
          <Button
            size="small"
            variant="contained"
            disabled={!canSave}
            onClick={() => void persist()}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        )}
      </DialogActions>
    </>
  )
  const boardPaneContent = (
    <Slide in={boardPane} direction="left" container={panesEl} mountOnEnter unmountOnExit>
      <Box
        sx={{
          gridArea: '1 / 1',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          bgcolor: 'background.paper',
        }}
      >
        <DialogTitle
          component="div"
          variant={compact ? 'subtitle1' : 'h6'}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: compact ? (inline ? 0 : 2) : undefined,
            py: compact ? (inline ? 0 : 1.5) : undefined,
            mb: inline ? 1.5 : 0,
            flexShrink: 0,
          }}
        >
          <Tooltip title="Back to Marker">
            <IconButton
              size="small"
              aria-label="Back to Marker"
              disabled={boardBusy}
              onClick={closeBoardPane}
            >
              <ArrowBack />
            </IconButton>
          </Tooltip>
          <Typography component="h2" variant={compact ? 'subtitle1' : 'h6'}>
            New Board
          </Typography>
        </DialogTitle>
        <DialogContent
          sx={{
            px: compact ? (inline ? 0 : 2) : undefined,
            pt: 0,
            flex: '1 1 auto',
            overflowY: 'auto',
          }}
          onKeyDown={(event) => {
            if (!canCreateBoard || !isSubmitKey(event)) return
            event.preventDefault()
            void saveNewBoard()
          }}
        >
          <Stack spacing={placement ? 1.5 : 2} sx={{ pt: 2 }}>
            {boardError && <Alert severity="error">{boardError}</Alert>}
            <BoardFields
              name={boardName}
              onNameChange={setBoardName}
              description={boardDescription}
              onDescriptionChange={setBoardDescription}
              visibility={boardVisibility}
              onVisibilityChange={setBoardVisibility}
              programIds={boardProgramIds}
              onProgramIdsChange={setBoardProgramIds}
              groupIds={boardGroupIds}
              onGroupIdsChange={setBoardGroupIds}
              programs={boardScope?.programs ?? []}
              groups={boardScope?.groups ?? []}
              disabled={boardBusy}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: compact ? (inline ? 0 : 2) : undefined, flexShrink: 0 }}>
          <Button
            size="small"
            variant="contained"
            disabled={!canCreateBoard}
            onClick={() => void saveNewBoard()}
          >
            {boardBusy ? 'Creating…' : 'Create Board'}
          </Button>
        </DialogActions>
      </Box>
    </Slide>
  )
  const panes = (
    <Box
      ref={setPanesRef}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        // Both panes share one grid cell, so the form grows to whichever is
        // taller instead of clipping the New Board pane to the Marker's height.
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr)',
        gridTemplateColumns: 'minmax(0, 1fr)',
        flex: '1 1 auto',
        minHeight: 0,
      }}
    >
      {/* The marker pane stays mounted beneath the Add Board slide-over so its
          scroll height, field values and focus state are preserved. */}
      <Box
        sx={{
          gridArea: '1 / 1',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          visibility: boardPane ? 'hidden' : undefined,
        }}
        inert={boardPane}
      >
        {content}
      </Box>
      {boardPaneContent}
    </Box>
  )
  const form = inline ? (
    <Box role="form" aria-label="Edit Marker" sx={formSx}>
      {panes}
    </Box>
  ) : placement ? (
    createPortal(
      <Paper
        role="dialog"
        aria-label="Add Marker"
        aria-modal={false}
        data-hriv-canvas-ui
        elevation={8}
        sx={{ ...markerPanelSx, ...formSx }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            if (boardPane) closeBoardPane()
            else onClose()
          }
        }}
      >
        {panes}
      </Paper>,
      container ?? document.body,
    )
  ) : (
    <Dialog
      open
      data-hriv-canvas-ui
      onClose={busy ? undefined : boardPane ? closeBoardPane : onClose}
      container={container}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { 'aria-labelledby': formTitleId } }}
    >
      {panes}
    </Dialog>
  )
  return (
    <>
      {form}
      {pickerAnchor && (
        <BoardPicker
          anchorEl={pickerAnchor}
          boards={orderedBoards}
          selectedIds={selectedIds}
          container={container}
          onToggle={toggleBoard}
          onCreate={() => {
            setPickerAnchor(null)
            openBoardPane()
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {baseline?.permissions.can_delete && confirmDelete && (
        <MarkerDeleteDialog
          title={baseline.title}
          container={container}
          busy={busy}
          confirmDisabled={!!conflict}
          error={errorAlert}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void persist(true)}
        />
      )}
    </>
  )
}
