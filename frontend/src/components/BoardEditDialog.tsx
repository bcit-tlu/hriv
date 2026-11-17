import { useContext, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { ApiError, createBoard, deleteBoard, fetchBoard, updateBoard, userMessage } from '../api'
import { AuthContext } from '../authContextValue'
import { getAttachableProgramIds } from '../programAttach'
import type { ApiBoardSummary, BoardVisibility, Group, Program } from '../types'

export interface BoardEditDialogProps {
  board?: ApiBoardSummary | null
  programs?: Program[]
  groups?: Group[]
  onClose: () => void
  onSaved: (board: ApiBoardSummary) => void
  onDeleted?: () => void
}

export default function BoardEditDialog({
  board = null,
  programs = [],
  groups = [],
  onClose,
  onSaved,
  onDeleted,
}: BoardEditDialogProps) {
  const user = useContext(AuthContext)?.currentUser ?? null
  const [baseline, setBaseline] = useState(board)
  const [name, setName] = useState(board?.name ?? '')
  const [description, setDescription] = useState(board?.description ?? '')
  const [visibility, setVisibility] = useState<BoardVisibility>(board?.visibility ?? 'private')
  const [programIds, setProgramIds] = useState<number[]>(board?.program_ids ?? [])
  const [groupIds, setGroupIds] = useState<number[]>(board?.group_ids ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const canChangeScope = baseline == null || baseline.permissions.can_change_scope
  const canRestrict = user?.role === 'instructor' || user?.role === 'admin'
  const attachable = getAttachableProgramIds(user)
  const toggle = (ids: number[], id: number) =>
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
  const reload = async () => {
    if (!baseline) return
    setBusy(true)
    try {
      const fresh = await fetchBoard(baseline.id)
      setBaseline(fresh)
      setName(fresh.name)
      setDescription(fresh.description ?? '')
      setVisibility(fresh.visibility)
      setProgramIds(fresh.program_ids)
      setGroupIds(fresh.group_ids)
      setConflict(false)
      setConfirmDelete(false)
      setError(null)
    } catch (err) {
      setError(userMessage(err, 'Unable to reload Board.'))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const scope = canChangeScope
        ? {
            visibility,
            program_ids: visibility === 'restricted' ? programIds : [],
            group_ids: visibility === 'restricted' ? groupIds : [],
          }
        : {}
      const values = { name: name.trim(), description: description.trim() || null, ...scope }
      const saved = baseline
        ? await updateBoard(baseline.id, { ...values, version: baseline.version })
        : await createBoard(values)
      onSaved(saved)
      onClose()
    } catch (err) {
      setConflict(err instanceof ApiError && err.status === 409)
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This Board changed. Reload the latest version before saving.'
          : userMessage(err, 'Unable to save Board.'),
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!baseline || !onDeleted) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteBoard(baseline.id, baseline.version)
      onDeleted()
      onClose()
    } catch (err) {
      setConflict(err instanceof ApiError && err.status === 409)
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This Board changed. Reload the latest version before deleting.'
          : userMessage(err, 'Unable to delete Board.'),
      )
    } finally {
      setBusy(false)
    }
  }
  const editable = !baseline || baseline.permissions.can_edit
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="board-edit-dialog-title"
    >
      <DialogTitle id="board-edit-dialog-title">
        {baseline ? 'Edit Board' : 'New Board'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Alert
              severity="error"
              action={
                conflict ? (
                  <Button onClick={() => void reload()} disabled={busy}>
                    Reload latest
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          )}
          <TextField
            label="Name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy || !editable}
          />
          <TextField
            label="Description"
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy || !editable}
          />
          {canChangeScope && (
            <TextField
              select
              label="Visibility"
              value={visibility}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'private' || value === 'public' || value === 'restricted')
                  setVisibility(value)
              }}
              disabled={busy || !editable}
            >
              <MenuItem value="private">Private</MenuItem>
              <MenuItem value="public">Public</MenuItem>
              {(canRestrict || visibility === 'restricted') && (
                <MenuItem value="restricted">Restricted</MenuItem>
              )}
            </TextField>
          )}
          {visibility === 'restricted' && canChangeScope && canRestrict && (
            <>
              <Typography variant="subtitle2" component="p">
                Programs
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {programs
                  .filter(
                    (p) =>
                      attachable == null ||
                      attachable.includes(p.id) ||
                      baseline?.program_ids.includes(p.id),
                  )
                  .map((p) => (
                    <Chip
                      key={p.id}
                      label={p.name}
                      variant={programIds.includes(p.id) ? 'filled' : 'outlined'}
                      color={programIds.includes(p.id) ? 'primary' : 'default'}
                      onClick={() => setProgramIds(toggle(programIds, p.id))}
                      disabled={busy || !editable}
                    />
                  ))}
              </Box>
              <Typography variant="subtitle2" component="p">
                Groups
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {groups
                  .filter(
                    (g) =>
                      user?.role === 'admin' ||
                      g.instructorIds.includes(user?.id ?? -1) ||
                      baseline?.group_ids.includes(g.id),
                  )
                  .map((g) => (
                    <Chip
                      key={g.id}
                      label={g.name}
                      variant={groupIds.includes(g.id) ? 'filled' : 'outlined'}
                      color={groupIds.includes(g.id) ? 'secondary' : 'default'}
                      onClick={() => setGroupIds(toggle(groupIds, g.id))}
                      disabled={busy || !editable}
                    />
                  ))}
              </Box>
              <Typography variant="caption">
                At least one Program or Group is required. Instructors may add only their own
                Programs and managed Groups; existing attachments may be removed.
              </Typography>
            </>
          )}
          {baseline?.permissions.can_delete && onDeleted && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Button
                  color="error"
                  variant={confirmDelete ? 'contained' : 'outlined'}
                  fullWidth
                  disabled={busy || conflict}
                  onClick={() => void remove()}
                >
                  {confirmDelete ? 'Confirm Delete Board' : 'Delete Board'}
                </Button>
                {confirmDelete && (
                  <Typography
                    variant="caption"
                    color="error"
                    sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
                  >
                    Delete “{baseline.name}”? Its links will be removed. Inuksuks only on this Board
                    will be permanently deleted. This action cannot be undone.
                  </Typography>
                )}
              </Box>
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
          onClick={() => void save()}
          disabled={
            busy ||
            conflict ||
            !editable ||
            !name.trim() ||
            (visibility === 'restricted' && programIds.length + groupIds.length === 0)
          }
        >
          Save Board
        </Button>
      </DialogActions>
    </Dialog>
  )
}
