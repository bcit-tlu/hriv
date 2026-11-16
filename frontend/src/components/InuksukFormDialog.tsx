import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import { inuksukPanelSx } from './inuksukPanelStyles'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CompassCalibration from '@mui/icons-material/CompassCalibration'
import * as api from '../api'
import type { ApiBoard, ApiBoardSummary, ApiInuksuk, BoardAssignment, InuksukView } from '../types'

const defaultServices = {
  fetchBoards: api.fetchBoards,
  fetchBoard: api.fetchBoard,
  createBoard: api.createBoard,
  createInuksuk: api.createInuksuk,
  updateInuksuk: api.updateInuksuk,
  deleteInuksuk: api.deleteInuksuk,
}
export interface InuksukFormDialogProps {
  imageId: number
  view: InuksukView
  item?: ApiInuksuk | null
  userId?: number
  container?: HTMLElement | null
  onClose: () => void
  onChanged: () => Promise<void> | void
  services?: typeof defaultServices
  placement?: boolean
  onTitleChange?: (title: string) => void
  initialDelete?: boolean
}
function storageKey(userId: number) {
  return `hrivpref:inuksuk:lastBoard:${userId}`
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

export default function InuksukFormDialog({
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
  initialDelete = false,
}: InuksukFormDialogProps) {
  const [baseline, setBaseline] = useState<api.InuksukConflict | null>(item)
  const [title, setTitle] = useState(item?.title ?? (placement ? 'New Inuksuk' : ''))
  const [moreOptions, setMoreOptions] = useState(!placement)
  const [description, setDescription] = useState(item?.description ?? '')
  const [favourite, setFavourite] = useState(item?.favourite ?? false)
  const [boards, setBoards] = useState<ApiBoardSummary[]>([])
  const [details, setDetails] = useState<Record<number, ApiBoard>>({})
  const [assignments, setAssignments] = useState<BoardAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [boardsLoaded, setBoardsLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<api.InuksukConflict | null>(null)
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(initialDelete)
  const editable = !baseline || baseline.permissions.can_edit

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
  const createBoard = async () => {
    if (!boardName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const board = await services.createBoard({ name: boardName.trim(), visibility: 'private' })
      setBoards((previous) => [...previous, board])
      setDetails((previous) => ({ ...previous, [board.id]: board }))
      setAssignments((previous) => [...previous, { board_id: board.id }])
      setBoardName('')
      setCreatingBoard(false)
    } catch (err) {
      setError(api.userMessage(err, 'Unable to create Board.'))
    } finally {
      setBusy(false)
    }
  }
  const persist = async (deleting = false) => {
    if (!deleting && baseline && !boardsLoaded) return
    setBusy(true)
    setError(null)
    try {
      if (deleting && baseline) await services.deleteInuksuk(baseline.id, baseline.version)
      else {
        const values = {
          title: title.trim(),
          description: description.trim() || null,
          favourite,
          board_assignments: assignments,
        }
        if (baseline)
          await services.updateInuksuk(baseline.id, { ...values, version: baseline.version })
        else {
          const { x, y, zoom, rotation } = view
          await services.createInuksuk({ x, y, zoom, rotation, ...values, image_id: imageId })
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
      await onChanged()
      onClose()
    } catch (err) {
      setConflict(api.inuksukConflictCurrent(err))
      setError(
        err instanceof api.ApiError && err.status === 409
          ? 'This Inuksuk changed since you opened it. Reload the current values before saving again.'
          : api.userMessage(err, 'Unable to save Inuksuk.'),
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
  const missingDetails = assignments.some((link) => !details[link.board_id])
  const content = (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CompassCalibration color="primary" />
        {baseline ? (editable ? 'Edit Inuksuk' : 'Inuksuk details') : 'Save a view'}
      </DialogTitle>
      <DialogContent>
        {baseline && !loading && !boardsLoaded && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Existing Board assignments could not be loaded. Close and reopen this dialog before
            saving changes.
          </Alert>
        )}
        <Stack spacing={placement ? 1.5 : 2} sx={{ pt: 1 }}>
          {!placement && (
            <Typography variant="body2" color="text.secondary">
              Keep this exact position, zoom and rotation on your Boards.
            </Typography>
          )}
          {error && (
            <Alert
              severity="error"
              action={
                conflict ? (
                  <Button color="inherit" onClick={reloadConflict}>
                    Reload current
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          )}
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
            size={placement ? 'small' : 'medium'}
            disabled={busy || !editable}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            autoFocus
          />
          {editable ? (
            <>
              <Autocomplete
                size={placement ? 'small' : 'medium'}
                slotProps={{ popper: { container } }}
                multiple
                options={boards}
                value={selected}
                loading={loading}
                disabled={busy || loading}
                getOptionLabel={(board) => board.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_event, value) => chooseBoards(value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Boards"
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
              {creatingBoard ? (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    label="New private Board name"
                    size="small"
                    value={boardName}
                    disabled={busy}
                    onChange={(event) => setBoardName(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: 255 } }}
                  />
                  <Button onClick={() => void createBoard()} disabled={busy || !boardName.trim()}>
                    Create Board
                  </Button>
                </Box>
              ) : (
                <Button
                  onClick={() => setCreatingBoard(true)}
                  sx={{ alignSelf: 'flex-start' }}
                  disabled={busy || loading}
                >
                  + Create new board
                </Button>
              )}
            </>
          ) : (
            <Typography variant="body2">
              Saved on {baseline?.board_ids.length} Board(s). Only its owners can edit this Inuksuk.
            </Typography>
          )}
          {placement && (
            <Button
              aria-expanded={moreOptions}
              onClick={() => setMoreOptions(!moreOptions)}
              sx={{ alignSelf: 'flex-start' }}
            >
              More options
            </Button>
          )}
          <Collapse in={moreOptions} unmountOnExit>
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy || !editable}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={favourite}
                  disabled={busy || !editable}
                  onChange={(event) => setFavourite(event.target.checked)}
                />
              }
              label="Favourite"
            />
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions>
        {baseline?.permissions.can_delete && (
          <Button
            color="error"
            disabled={busy || !!conflict}
            onClick={() => (confirmDelete ? void persist(true) : setConfirmDelete(true))}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={onClose}>
          {editable ? 'Cancel' : 'Close'}
        </Button>
        {editable && (
          <Button
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
            {busy ? 'Saving…' : baseline ? 'Save changes' : placement ? 'Save' : 'Save to Board'}
          </Button>
        )}
      </DialogActions>
    </>
  )
  return placement ? (
    createPortal(
      <Paper
        role="dialog"
        aria-label="Save a view"
        aria-modal={false}
        data-hriv-canvas-ui
        elevation={8}
        sx={inuksukPanelSx}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        {content}
      </Paper>,
      container ?? document.body,
    )
  ) : (
    <Dialog
      open
      data-hriv-canvas-ui
      onClose={busy ? undefined : onClose}
      container={container}
      fullWidth
      maxWidth="sm"
    >
      {content}
    </Dialog>
  )
}
