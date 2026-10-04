import { useContext, useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { userMessage } from '../api'
import { AuthContext } from '../authContextValue'
import { describeCollectionOwner } from '../collectionUtils'
import type { CollectionSummary, Program, User } from '../types'

export type CollectionTransferTarget = { userId: number } | { programId: number }

export interface TransferCollectionDialogProps {
  open: boolean
  onClose: () => void
  /** Collection being reassigned (a summary is enough — the hook resolves the version). */
  collection: CollectionSummary | null
  /** All programs; instructors are narrowed to their own inside this dialog. */
  programs?: Program[]
  /**
   * Persist the transfer. Rejections are surfaced inside the dialog via
   * `userMessage` (403 unauthorized target, 409 stale version, 422 invalid
   * or inactive target); on success the dialog closes.
   */
  onTransfer: (id: number, target: CollectionTransferTarget) => Promise<unknown>
}

const EMPTY_PROGRAMS: Program[] = []

type TargetKind = 'user' | 'program'

export default function TransferCollectionDialog({
  open,
  onClose,
  collection,
  programs = EMPTY_PROGRAMS,
  onTransfer,
}: TransferCollectionDialogProps) {
  const auth = useContext(AuthContext)
  const currentUser = auth?.currentUser ?? null
  const isAdmin = currentUser?.role === 'admin'
  // The admin user list is already loaded into the auth context at login;
  // the backend additionally 422s inactive accounts as transfer targets.
  const userOptions = isAdmin ? (auth?.users ?? []).filter((u) => u.active) : []
  // Instructors may only transfer to programs they belong to (the backend
  // re-checks with the same rule and 403s anything else).
  const programOptions = isAdmin
    ? programs
    : programs.filter((p) => currentUser?.program_ids.includes(p.id))

  const [targetKind, setTargetKind] = useState<TargetKind>('program')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedProgramId, setSelectedProgramId] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset on each open transition (same pattern as CollectionEditDialog) and
  // refresh the admin user list so recent accounts are pickable.
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setTargetKind('program')
      setSelectedUser(null)
      setSelectedProgramId('')
      setError(null)
      setSaving(false)
      auth?.refreshUsers?.()
    }
    prevOpen.current = open
  }, [open, auth])

  const owner = collection?.owner ?? null
  const unchangedTarget =
    (targetKind === 'user' && owner?.kind === 'user' && owner.userId === selectedUser?.id) ||
    (targetKind === 'program' && owner?.kind === 'program' && owner.programId === selectedProgramId)
  const target: CollectionTransferTarget | null =
    targetKind === 'user'
      ? selectedUser != null
        ? { userId: selectedUser.id }
        : null
      : selectedProgramId !== ''
        ? { programId: selectedProgramId }
        : null
  const canConfirm = collection != null && target != null && !unchangedTarget && !saving

  const handleConfirm = () => {
    if (collection == null || target == null) return
    setSaving(true)
    setError(null)
    onTransfer(collection.id, target)
      .then(() => onClose())
      .catch((err) => setError(userMessage(err, 'Failed to transfer the collection.')))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transfer ownership</DialogTitle>
      <DialogContent>
        {collection && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <strong>{collection.name}</strong> is currently owned by{' '}
            {describeCollectionOwner(collection.owner)}.
            {owner?.kind === 'program' && ` Managed by program ${owner.name}.`}
          </Typography>
        )}

        {isAdmin && (
          <RadioGroup
            row
            aria-label="Transfer target"
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value as TargetKind)}
            sx={{ mb: 1 }}
          >
            <FormControlLabel value="user" control={<Radio />} label="A user" />
            <FormControlLabel value="program" control={<Radio />} label="A program" />
          </RadioGroup>
        )}

        {targetKind === 'user' && isAdmin ? (
          <Autocomplete
            data-testid="transfer-user-select"
            options={userOptions}
            value={selectedUser}
            getOptionLabel={(u) => `${u.name} (${u.email})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_e, u) => setSelectedUser(u)}
            disabled={saving}
            renderInput={(params) => <TextField {...params} label="New owner" margin="normal" />}
          />
        ) : (
          <FormControl fullWidth margin="normal">
            <InputLabel id="transfer-program-label">New owning program</InputLabel>
            <Select
              labelId="transfer-program-label"
              data-testid="transfer-program-select"
              label="New owning program"
              value={selectedProgramId}
              onChange={(e) => setSelectedProgramId(e.target.value as number)}
              disabled={saving}
            >
              {programOptions.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
            {programOptions.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                You do not belong to any programs.
              </Typography>
            )}
          </FormControl>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="transfer-error">
            {error}
          </Alert>
        )}
        {owner == null && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This collection is orphaned — assigning an owner restores normal management.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!canConfirm}
          data-testid="transfer-confirm"
        >
          {saving ? 'Transferring…' : 'Transfer'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
