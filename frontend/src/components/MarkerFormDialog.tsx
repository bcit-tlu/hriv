import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { isSubmitKey, useInitialFocus } from '../formKeys'
import { createPortal } from 'react-dom'
import { markerAccentColor, markerFavouriteButtonSx } from '../theme'
import Paper from '@mui/material/Paper'
import { markerPanelSx } from './markerPanelStyles'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import Link from '@mui/material/Link'
import Slide from '@mui/material/Slide'
import Tooltip from '@mui/material/Tooltip'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import Add from '@mui/icons-material/Add'
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
const MAX_BOARD_ROWS = 6
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
function BoardChipGroup({
  boards,
  selectedIds,
  disabled,
  onToggle,
  onShowAll,
  onNewBoard,
  newBoardRef,
}: {
  boards: ApiBoardSummary[]
  selectedIds: Set<number>
  disabled: boolean
  onToggle: (board: ApiBoardSummary) => void
  onShowAll: (hidden: number[]) => void
  onNewBoard: () => void
  newBoardRef: Ref<HTMLDivElement>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const signature = boards.map((board) => `${board.id}:${board.name}`).join('|')
  const [fit, setFit] = useState<{ key: string; count: number } | null>(null)
  const visible = fit?.key === signature ? fit.count : boards.length
  // Measures the full chip list and keeps the longest prefix whose wrapped
  // rows, plus the trailing "…more" and "+ New Board", fit MAX_BOARD_ROWS.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let width: number | null = null
    const measure = () => {
      const box = el.getBoundingClientRect()
      const items = Array.from(el.children) as HTMLElement[]
      const chips = items.filter((item) => item.dataset.boardChip != null)
      if (chips.length < boards.length) return
      const more = items.find((item) => item.dataset.boardMore != null)
      const add = items.find((item) => item.dataset.boardNew != null)
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const rects = chips.map((chip) => chip.getBoundingClientRect())
      const tops = [...new Set(rects.map((rect) => Math.round(rect.top)))].sort((x, y) => x - y)
      const place = ([row, right]: [number, number], size: number): [number, number] =>
        right < 0 || right + gap + size <= box.width
          ? [row, right < 0 ? size : right + gap + size]
          : [row + 1, size]
      let count = 0
      for (let k = chips.length; k >= 0; k--) {
        const last = rects[k - 1]
        const start: [number, number] = last
          ? [tops.indexOf(Math.round(last.top)), last.right - box.left]
          : [0, -1]
        if (start[0] >= MAX_BOARD_ROWS) continue
        const trailing = k === chips.length ? [add] : [more, add]
        const end = trailing.reduce(
          (at, item) => place(at, item?.getBoundingClientRect().width ?? 0),
          start,
        )
        if (end[0] < MAX_BOARD_ROWS) {
          count = k
          break
        }
      }
      setFit(count === chips.length ? null : { key: signature, count })
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      const resized = width != null && next !== width
      width = next
      // A truncated list is re-measured from its full layout after a resize.
      if (resized && el.querySelectorAll('[data-board-chip]').length < boards.length) setFit(null)
      else measure()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [signature, boards.length])
  const shown = boards.slice(0, visible)
  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      {shown.map((board) => {
        const selected = selectedIds.has(board.id)
        return (
          <Chip
            key={board.id}
            data-board-chip=""
            data-board-id={board.id}
            label={board.name}
            size="small"
            color={selected ? 'primary' : 'default'}
            variant={selected ? 'filled' : 'outlined'}
            aria-pressed={selected}
            onClick={() => onToggle(board)}
            disabled={disabled}
            sx={{ maxWidth: '100%' }}
          />
        )
      })}
      <Link
        component="button"
        type="button"
        variant="body2"
        data-board-more=""
        disabled={disabled}
        onClick={() => onShowAll(boards.slice(visible).map((board) => board.id))}
        aria-label={`Show all ${boards.length} Boards`}
        aria-hidden={visible < boards.length ? undefined : true}
        tabIndex={visible < boards.length ? undefined : -1}
        sx={{
          px: 0.5,
          ...(visible < boards.length ? {} : { position: 'absolute', visibility: 'hidden' }),
        }}
      >
        …more
      </Link>
      <Chip
        ref={newBoardRef}
        data-board-new=""
        icon={<Add />}
        label="New Board"
        size="small"
        variant="outlined"
        onClick={onNewBoard}
        disabled={disabled}
      />
    </Box>
  )
}

/** "…more" picker: every editable Board as a filterable toggle chip. */
function BoardPickerDialog({
  boards,
  selectedIds,
  container,
  onToggle,
  onClose,
}: {
  boards: ApiBoardSummary[]
  selectedIds: Set<number>
  container?: HTMLElement | null
  onToggle: (board: ApiBoardSummary) => void
  onClose: () => void
}) {
  const titleId = useId()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const matching = [...boards]
    .filter((board) => board.name.toLocaleLowerCase().includes(needle))
    .sort(byName)
  return (
    <Dialog
      open
      container={container}
      data-hriv-canvas-ui
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <DialogTitle id={titleId}>Choose Boards</DialogTitle>
      <DialogContent sx={{ '.MuiDialogTitle-root + &': { pt: 1 } }}>
        <TextField
          label="Filter Boards"
          size="small"
          fullWidth
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 1.5 }}
        />
        <Box role="group" aria-label="Boards" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {matching.map((board) => {
            const selected = selectedIds.has(board.id)
            return (
              <Chip
                key={board.id}
                label={board.name}
                size="small"
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                aria-pressed={selected}
                onClick={() => onToggle(board)}
                sx={{ maxWidth: '100%' }}
              />
            )
          })}
        </Box>
        {matching.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No matching Boards.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** The shared "Delete Marker?" confirmation — the marker form's secondary
 *  dialog and the viewer drawer Delete action render this same surface. */
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
  const [pickerHidden, setPickerHidden] = useState<number[] | null>(null)
  const boardsHelperId = useId()
  const formTitleId = useId()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const panesRef = useRef<HTMLDivElement>(null)
  const [panesEl, setPanesEl] = useState<HTMLDivElement | null>(null)
  const setPanesRef = useCallback((el: HTMLDivElement | null) => {
    panesRef.current = el
    setPanesEl(el)
  }, [])
  const newBoardRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const editable = !baseline || baseline.permissions.can_edit

  const closeBoardPane = useCallback(() => {
    setBoardPane(false)
    requestAnimationFrame(() => newBoardRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!inline) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmDelete || pickerHidden) return
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
    pickerHidden,
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
  const closePicker = () => {
    // Boards chosen from the overflow move to the front so they stay visible.
    const promoted = (pickerHidden ?? []).filter((id) =>
      assignments.some((link) => link.board_id === id),
    )
    if (promoted.length)
      setBoardOrder((previous) => [...promoted, ...previous.filter((id) => !promoted.includes(id))])
    setPickerHidden(null)
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
      requestAnimationFrame(() =>
        panesRef.current?.querySelector<HTMLElement>(`[data-board-id="${board.id}"]`)?.focus(),
      )
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
            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {inline
              ? baseline?.title
              : baseline
                ? editable
                  ? 'Edit Marker'
                  : 'Marker details'
                : 'Add Marker'}
          </Typography>
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
          <FormControl
            component="fieldset"
            required
            aria-describedby={boardsHelperId}
            sx={{ minWidth: 0 }}
          >
            <FormLabel
              component="legend"
              sx={{
                typography: 'subtitle2',
                color: 'text.primary',
                mb: 0.75,
                '&.Mui-focused': { color: 'text.primary' },
              }}
            >
              Boards
            </FormLabel>
            <BoardChipGroup
              boards={orderedBoards}
              selectedIds={selectedIds}
              disabled={busy || loading}
              onToggle={toggleBoard}
              onShowAll={setPickerHidden}
              onNewBoard={openBoardPane}
              newBoardRef={newBoardRef}
            />
            {(loading || boards.length === 0 || !placement) && (
              <FormHelperText id={boardsHelperId} sx={{ mx: 0 }}>
                {loading
                  ? 'Loading Boards…'
                  : boards.length === 0
                    ? 'Create a Board to save this Marker.'
                    : 'Choose at least one Board. Only Boards you can edit are listed.'}
              </FormHelperText>
            )}
          </FormControl>
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
        {editable && (
          <Button
            size="small"
            variant="contained"
            disabled={!canSave}
            onClick={() => void persist()}
          >
            {busy
              ? 'Saving…'
              : inline || placement
                ? 'Save'
                : baseline
                  ? 'Save changes'
                  : 'Save to Board'}
          </Button>
        )}
      </DialogActions>
    </>
  )
  const boardPaneContent = (
    <Slide in={boardPane} direction="left" container={panesEl} mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
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
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
      }}
    >
      {/* The marker pane stays mounted beneath the absolute Add Board slide-over
          so its scroll height, field values and focus state are preserved. */}
      <Box
        sx={{ display: 'contents', visibility: boardPane ? 'hidden' : undefined }}
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
      {pickerHidden && (
        <BoardPickerDialog
          boards={boards}
          selectedIds={selectedIds}
          container={container}
          onToggle={toggleBoard}
          onClose={closePicker}
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
