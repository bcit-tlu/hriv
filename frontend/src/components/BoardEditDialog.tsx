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
  FormControlLabel,
  Radio,
  RadioGroup,
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

export interface BoardFieldsProps {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  visibility: BoardVisibility
  onVisibilityChange: (value: BoardVisibility) => void
  programIds: number[]
  onProgramIdsChange: (value: number[]) => void
  groupIds: number[]
  onGroupIdsChange: (value: number[]) => void
  baseline?: ApiBoardSummary | null
  programs?: Program[]
  groups?: Group[]
  disabled?: boolean
}

/** The editable Board fields shared by BoardEditDialog and MarkerFormDialog's
 *  slide-in Add Board pane: name, description and, when scope changes are
 *  allowed, visibility plus restricted Program/Group chips. */
export function BoardFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  visibility,
  onVisibilityChange,
  programIds,
  onProgramIdsChange,
  groupIds,
  onGroupIdsChange,
  baseline = null,
  programs = [],
  groups = [],
  disabled = false,
}: BoardFieldsProps) {
  const user = useContext(AuthContext)?.currentUser ?? null
  const canChangeScope = baseline == null || baseline.permissions.can_change_scope
  const canRestrict = user?.role === 'instructor' || user?.role === 'admin'
  const attachable = getAttachableProgramIds(user)
  const toggle = (ids: number[], id: number) =>
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
  return (
    <>
      <TextField
        label="Name"
        required
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        disabled={disabled}
      />
      <TextField
        label="Description"
        multiline
        minRows={2}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        disabled={disabled}
      />
      {canChangeScope && (
        <Box>
          <Typography variant="subtitle2" component="p" gutterBottom>
            Visible to
          </Typography>
          <RadioGroup
            aria-label="Visibility"
            value={visibility}
            onChange={(e) => {
              const value = e.target.value
              if (value === 'private' || value === 'public' || value === 'restricted')
                onVisibilityChange(value)
            }}
          >
            <FormControlLabel
              value="private"
              control={<Radio size="small" />}
              label="Private — only you"
              disabled={disabled}
            />
            <FormControlLabel
              value="public"
              control={<Radio size="small" />}
              label="Public — everyone who can sign in"
              disabled={disabled}
            />
            {(canRestrict || visibility === 'restricted') && (
              <FormControlLabel
                value="restricted"
                control={<Radio size="small" />}
                label="Restricted — specific programs and/or groups"
                disabled={disabled}
              />
            )}
          </RadioGroup>
        </Box>
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
                  onClick={() => onProgramIdsChange(toggle(programIds, p.id))}
                  disabled={disabled}
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
                  onClick={() => onGroupIdsChange(toggle(groupIds, g.id))}
                  disabled={disabled}
                />
              ))}
          </Box>
          <Typography variant="caption">
            At least one Program or Group is required. Instructors may add only their own Programs
            and managed Groups; existing attachments may be removed.
          </Typography>
        </>
      )}
    </>
  )
}

export default function BoardEditDialog({
  board = null,
  programs = [],
  groups = [],
  onClose,
  onSaved,
  onDeleted,
}: BoardEditDialogProps) {
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
      <DialogTitle id="board-edit-dialog-title" sx={baseline ? undefined : { pb: 1 }}>
        {baseline ? 'Edit Board' : 'New Board'}
      </DialogTitle>
      <DialogContent>
        {!baseline && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Boards collect saved image views (Markers) for study and sharing.
          </Typography>
        )}
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Alert
              severity="error"
              action={
                conflict ? (
                  <Button size="small" onClick={() => void reload()} disabled={busy}>
                    Reload latest
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          )}
          <BoardFields
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            programIds={programIds}
            onProgramIdsChange={setProgramIds}
            groupIds={groupIds}
            onGroupIdsChange={setGroupIds}
            baseline={baseline}
            programs={programs}
            groups={groups}
            disabled={busy || !editable}
          />
          {baseline?.permissions.can_delete && onDeleted && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Button
                  size="small"
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
                    Delete “{baseline.name}”? Its links will be removed. Markers only on this Board
                    will be permanently deleted. This action cannot be undone.
                  </Typography>
                )}
              </Box>
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
