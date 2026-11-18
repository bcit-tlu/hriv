import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import type { PaperProps } from '@mui/material/Paper'
import { markerPanelSx } from './markerPanelStyles'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CheckBox from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlank from '@mui/icons-material/CheckBoxOutlineBlank'
import IconButton from '@mui/material/IconButton'
import ListItemButton from '@mui/material/ListItemButton'
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
  '& .MuiAutocomplete-tag': { typography: 'caption' },
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
  inline?: boolean
  onEscape?: () => void
}
function storageKey(userId: number) {
  return `hrivpref:marker:lastBoard:${userId}`
}
function lastBoard(userId: number | undefined): number | null {
  try {
    if (userId == null) return null
    const id = Number(localStorage.getItem(storageKey(userId)))
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
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
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
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
  const [moreOptions, setMoreOptions] = useState(!placement && !inline)
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
  const [boardQuery, setBoardQuery] = useState('')
  const [boardsMenuOpen, setBoardsMenuOpen] = useState(false)
  const boardsDescriptionId = useId()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const panesRef = useRef<HTMLDivElement>(null)
  const [panesEl, setPanesEl] = useState<HTMLDivElement | null>(null)
  const setPanesRef = useCallback((el: HTMLDivElement | null) => {
    panesRef.current = el
    setPanesEl(el)
  }, [])
  const boardsInputRef = useRef<HTMLInputElement>(null)
  const editable = !baseline || baseline.permissions.can_edit

  const closeBoardPane = useCallback(() => {
    setBoardPane(false)
    requestAnimationFrame(() => boardsInputRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!inline) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmDelete) return
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
  }, [inline, busy, container, onClose, onEscape, confirmDelete, boardPane, closeBoardPane])

  useEffect(() => {
    let cancelled = false
    services
      .fetchBoards()
      .then(async (rows) => {
        const editableBoards = rows.filter((board) => board.permissions.can_edit)
        const remembered = lastBoard(userId)
        const ids = baseline?.board_ids ?? (remembered == null ? [] : [remembered])
        const selected = editableBoards.filter((board) => ids.includes(board.id))
        const loaded = await Promise.all(selected.map((board) => services.fetchBoard(board.id)))
        if (cancelled) return
        setBoards(editableBoards)
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

  const chooseBoards = (selected: ApiBoardSummary[]) => {
    setAssignments(
      selected.map(
        (board) =>
          assignments.find((link) => link.board_id === board.id) ?? {
            board_id: board.id,
          },
      ),
    )
    for (const board of selected) {
      if (details[board.id]) continue
      services
        .fetchBoard(board.id)
        .then((value) => setDetails((previous) => ({ ...previous, [value.id]: value })))
        .catch((err) => setError(api.userMessage(err, 'Unable to load this Board.')))
    }
  }
  const openBoardPane = useCallback(() => {
    setBoardsMenuOpen(false)
    setBoardQuery('')
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
      setDetails((previous) => ({ ...previous, [board.id]: board }))
      setAssignments((previous) => [...previous, { board_id: board.id }])
      setBoardPane(false)
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
        const remembered = assignments.at(-1)?.board_id
        if (userId != null && remembered != null) {
          try {
            localStorage.setItem(storageKey(userId), String(remembered))
          } catch {
            /* Storage is optional. */
          }
        }
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
  const selected = boards.filter((board) => assignments.some((link) => link.board_id === board.id))
  const selectedText =
    selected
      .slice(0, 2)
      .map((board) => board.name)
      .join(', ') + (selected.length > 2 ? ` +${selected.length - 2}` : '')
  const matchingBoards = boards
    .filter((board) =>
      board.name.toLocaleLowerCase().includes(boardQuery.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id - b.id,
    )
  const missingDetails = assignments.some((link) => !details[link.board_id])
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
  // Fixed-height Boards menu: options scroll inside the listbox while the
  // pinned "+ Add Board" row stays at the bottom of the paper.
  const boardsListPaper = useCallback(
    (props: PaperProps) => (
      <Paper
        {...props}
        sx={[
          { display: 'flex', flexDirection: 'column', maxHeight: 232 },
          ...(Array.isArray(props.sx) ? props.sx : props.sx ? [props.sx] : []),
        ]}
      >
        {props.children}
        <ListItemButton
          dense
          disabled={busy}
          // Preventing the default here keeps the Autocomplete input focused,
          // so the popup isn't torn down before this click lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={openBoardPane}
          sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider' }}
        >
          <Add fontSize="small" sx={{ mr: 1 }} />
          Add Board
        </ListItemButton>
      </Paper>
    ),
    [busy, openBoardPane],
  )
  const content = (
    <>
      <DialogTitle
        component="div"
        variant="subtitle2"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: inline ? 0 : 2,
          py: inline ? 0 : 1.25,
          mb: inline ? 1 : 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Room color="primary" fontSize="small" />
          <Typography
            component="h2"
            variant="subtitle2"
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
        {editable && (
          <Tooltip title={favourite ? 'Remove favourite' : 'Add favourite'}>
            <IconButton
              size="small"
              aria-label="Favourite"
              aria-pressed={favourite}
              disabled={busy}
              onClick={() => setFavourite(!favourite)}
              color={favourite ? 'primary' : 'default'}
            >
              {favourite ? <Star fontSize="small" /> : <StarBorder fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </DialogTitle>
      <DialogContent sx={{ px: inline ? 0 : 2 }}>
        {baseline && !loading && !boardsLoaded && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Existing Board assignments could not be loaded. Close and reopen this dialog before
            saving changes.
          </Alert>
        )}
        <Stack spacing={1} sx={{ pt: 1 }}>
          {!placement && !inline && (
            <Typography variant="caption" component="p" color="text.secondary">
              Keep this exact position, zoom and rotation on your Boards.
            </Typography>
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
            size="small"
            disabled={busy || !editable}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            autoFocus
          />
          {editable ? (
            <Autocomplete<ApiBoardSummary, true>
              size="small"
              multiple
              disableCloseOnSelect
              open={boardsMenuOpen}
              onOpen={() => {
                setBoardsMenuOpen(true)
              }}
              onClose={() => {
                setBoardsMenuOpen(false)
                setBoardQuery('')
              }}
              inputValue={boardQuery}
              onInputChange={(_event, value, reason) => {
                if (reason === 'input') setBoardQuery(value)
              }}
              renderTags={() =>
                boardsMenuOpen ? null : (
                  <Box
                    component="span"
                    id={boardsDescriptionId}
                    sx={{
                      maxWidth: 'calc(100% - 30px)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedText}
                  </Box>
                )
              }
              options={matchingBoards}
              filterOptions={(options) => options}
              value={selected}
              loading={loading}
              disabled={busy || loading}
              getOptionLabel={(board) => board.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_event, value) => chooseBoards(value)}
              slots={{ paper: boardsListPaper }}
              slotProps={{
                popper: { container: container ?? undefined, disablePortal: container == null },
                listbox: {
                  sx: { flex: '0 1 auto', minHeight: 0, overflowY: 'auto', maxHeight: 'unset' },
                },
              }}
              renderOption={({ key, ...props }, option, state) => (
                <li key={key} {...props}>
                  <Box
                    component="span"
                    aria-hidden="true"
                    sx={{
                      display: 'inline-flex',
                      p: 1,
                      color: state.selected ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {state.selected ? (
                      <CheckBox fontSize="small" />
                    ) : (
                      <CheckBoxOutlineBlank fontSize="small" />
                    )}
                  </Box>
                  {option.name}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  inputRef={boardsInputRef}
                  label="Boards"
                  slotProps={{
                    htmlInput: {
                      ...params.inputProps,
                      'aria-describedby': `${params.id}-helper-text ${boardsDescriptionId}`,
                    },
                  }}
                  required
                  helperText={
                    loading
                      ? 'Loading Boards…'
                      : placement
                        ? undefined
                        : 'Choose at least one Board. Only Boards you can edit are listed.'
                  }
                />
              )}
            />
          ) : (
            <Typography variant="caption" component="p">
              Saved on {baseline?.board_ids.length} Board(s). Only its owners can edit this Marker.
            </Typography>
          )}
          {(placement || inline) && (
            <Button
              size="small"
              aria-expanded={moreOptions}
              onClick={() => setMoreOptions(!moreOptions)}
              sx={{ alignSelf: 'flex-start' }}
            >
              More options
            </Button>
          )}
          <Collapse in={moreOptions} unmountOnExit>
            <TextField
              size="small"
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy || !editable}
            />
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: inline ? 0 : 2, py: 1 }}>
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
        {baseline?.permissions.can_delete && (
          <Button
            size="small"
            color="error"
            disabled={busy || !!conflict}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
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
            disabled={
              busy ||
              loading ||
              (!!baseline && !boardsLoaded) ||
              missingDetails ||
              !!conflict ||
              !title.trim() ||
              assignments.length === 0
            }
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
          bgcolor: 'background.paper',
        }}
      >
        <DialogTitle
          component="div"
          variant="subtitle2"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: inline ? 0 : 2,
            py: inline ? 0.5 : 1.25,
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
              <ArrowBack fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography component="h2" variant="subtitle2" sx={{ flex: 1, textAlign: 'center' }}>
            New Board
          </Typography>
          <Button
            size="small"
            variant="contained"
            disabled={
              boardBusy ||
              !boardName.trim() ||
              (boardVisibility === 'restricted' &&
                boardProgramIds.length + boardGroupIds.length === 0)
            }
            onClick={() => void saveNewBoard()}
          >
            {boardBusy ? 'Creating…' : 'Create Board'}
          </Button>
        </DialogTitle>
        <DialogContent sx={{ px: inline ? 0 : 2, flex: '1 1 auto', overflowY: 'auto' }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
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
      slotProps={{ paper: { sx: formSx } }}
    >
      {panes}
    </Dialog>
  )
  return (
    <>
      {form}
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
