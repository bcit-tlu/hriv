import { useContext, useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { fetchUsersPaged, userMessage } from '../api'
import { AuthContext } from '../authContextValue'
import { describeCollectionOwners } from '../collectionUtils'
import type { CollectionSummary, Program } from '../types'

/** Minimal identity needed to render an owner chip (id + label). */
interface OwnerOption {
  id: number
  name: string
  email: string
}

export interface CollectionOwnersDialogProps {
  open: boolean
  onClose: () => void
  /** Collection being managed (a summary is enough — the hook resolves the version). */
  collection: CollectionSummary | null
  /** All programs; instructors are narrowed to their own inside this dialog. */
  programs?: Program[]
  /**
   * Replace the user-owner set (`PUT …/owners`). Rejections are surfaced
   * inside the dialog via `userMessage` (403 unauthorized, 409 stale
   * version, 422 unknown/inactive targets or the orphan guard); on success
   * the dialog closes.
   */
  onSaveOwners: (id: number, userIds: number[]) => Promise<unknown>
  /**
   * Reassign program ownership (`POST …/transfer`). Setting a program clears
   * the user-owner rows server-side; `null` clears the program owner.
   */
  onTransfer: (id: number, programId: number | null) => Promise<unknown>
}

const EMPTY_PROGRAMS: Program[] = []

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Owners & transfer (#1531): edit the co-owner set and/or reassign program
 * ownership from one place. Rendered only where `permissions.canTransfer`
 * allows (admin, or an instructor who owns the collection / belongs to its
 * owning program); the backend re-checks the same matrix on both endpoints.
 */
export default function CollectionOwnersDialog({
  open,
  onClose,
  collection,
  programs = EMPTY_PROGRAMS,
  onSaveOwners,
  onTransfer,
}: CollectionOwnersDialogProps) {
  const auth = useContext(AuthContext)
  const currentUser = auth?.currentUser ?? null
  const isAdmin = currentUser?.role === 'admin'
  // Instructors may only transfer to programs they belong to (the backend
  // re-checks with the same rule and 403s anything else).
  const programOptions = isAdmin
    ? programs
    : programs.filter((p) => currentUser?.program_ids.includes(p.id))

  const currentUserOwnerIds = (collection?.owners ?? [])
    .filter((o) => o.kind === 'user')
    .map((o) => o.userId)
  const currentProgramId = collection?.owners.find((o) => o.kind === 'program')?.programId ?? null

  const [selectedOwners, setSelectedOwners] = useState<OwnerOption[]>([])
  const [userOptions, setUserOptions] = useState<OwnerOption[]>([])
  const [query, setQuery] = useState('')
  // Role-scoped directory search mirroring GroupManagementModal: instructors
  // choose between Students and Instructors (admins and staff are never
  // listed to them); admins additionally get an unscoped "Everyone" mode.
  const [roleTab, setRoleTab] = useState<'student' | 'instructor' | 'all'>(
    isAdmin ? 'all' : 'student',
  )
  // Optional program narrowing — applies to the Students search only,
  // exactly like the group member picker (co-instructors stay global).
  const [programFilterIds, setProgramFilterIds] = useState<number[]>([])
  // `''` = "no program owner" (MUI Select needs a concrete value, not null).
  const [selectedProgramId, setSelectedProgramId] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset on each open transition (same pattern as CollectionEditDialog).
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setSelectedOwners(
        (collection?.owners ?? [])
          .filter((o) => o.kind === 'user')
          .map((o) => ({ id: o.userId, name: o.name, email: '' })),
      )
      setUserOptions([])
      setQuery('')
      setRoleTab(isAdmin ? 'all' : 'student')
      setProgramFilterIds([])
      setSelectedProgramId(collection?.owners.find((o) => o.kind === 'program')?.programId ?? '')
      setError(null)
      setSaving(false)
    }
    prevOpen.current = open
  }, [open, collection, isAdmin])

  // Debounced people search — the same endpoint the group-membership picker
  // uses, so instructors see the scoped mini-projection automatically.
  // Program narrowing applies to the Students search only (group parity);
  // "Everyone" (admins only) sends no role param.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetchUsersPaged({
        role: roleTab === 'all' ? undefined : roleTab,
        programIds:
          roleTab === 'student' && programFilterIds.length > 0 ? programFilterIds : undefined,
        q: query || undefined,
        pageSize: 50,
      })
        .then(({ items }) => {
          if (cancelled) return
          // Inactive accounts cannot hold owner rows (backend 422s them).
          setUserOptions(
            items.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, email: u.email })),
          )
        })
        .catch(() => {
          if (!cancelled) setUserOptions([])
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, roleTab, programFilterIds])

  // A program owner clears the user-owner rows on transfer, so the owner
  // picker only makes sense while no program is being assigned.
  const programAssigned = selectedProgramId !== ''
  const ownersChanged = !sameIds(
    selectedOwners.map((o) => o.id),
    currentUserOwnerIds,
  )
  const programChanged = (selectedProgramId || null) !== currentProgramId
  // Clearing the program needs surviving user owners; an empty dialog-wide
  // owner set is what the backend's orphan guard rejects (422).
  const wouldOrphan = !programAssigned && selectedOwners.length === 0
  const canConfirm =
    collection != null && (ownersChanged || programChanged) && !wouldOrphan && !saving

  const handleConfirm = () => {
    if (collection == null) return
    setSaving(true)
    setError(null)
    const id = collection.id
    const jobs: Array<() => Promise<unknown>> = []
    // Save owners before clearing the program owner so the collection is
    // never momentarily orphaned; when a program is being newly assigned the
    // transfer clears the owner rows itself, so the owners PUT is moot — but
    // staging co-owners alongside an unchanged program owner is allowed.
    if (ownersChanged && !(programAssigned && programChanged)) {
      jobs.push(() =>
        onSaveOwners(
          id,
          selectedOwners.map((o) => o.id),
        ),
      )
    }
    if (programChanged) jobs.push(() => onTransfer(id, selectedProgramId || null))
    let chain = Promise.resolve<unknown>(undefined)
    for (const job of jobs) chain = chain.then(job)
    chain
      .then(() => onClose())
      .catch((err) => setError(userMessage(err, 'Failed to update ownership.')))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="collection-owners-title"
    >
      <DialogTitle id="collection-owners-title">Owners</DialogTitle>
      <DialogContent>
        {collection && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <strong>{collection.name}</strong> is currently owned by{' '}
            {describeCollectionOwners(collection.owners)}.
          </Typography>
        )}

        <ToggleButtonGroup
          size="small"
          exclusive
          value={roleTab}
          onChange={(_e, v: 'student' | 'instructor' | 'all' | null) => {
            if (v != null) {
              setRoleTab(v)
              // Scope changed — drop stale suggestions now, not when the
              // debounced refetch resolves (they're wrong for the new role).
              setUserOptions([])
            }
          }}
          aria-label="Owner search scope"
          disabled={saving || programAssigned}
          sx={{ mt: 1 }}
        >
          <ToggleButton value="student">Students</ToggleButton>
          <ToggleButton value="instructor">Instructors</ToggleButton>
          {isAdmin && <ToggleButton value="all">Everyone</ToggleButton>}
        </ToggleButtonGroup>
        {!isAdmin && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            The directory lists students and instructors; admin and staff accounts are not shown.
          </Typography>
        )}

        <Autocomplete
          multiple
          data-testid="owners-select"
          options={userOptions}
          value={selectedOwners}
          filterSelectedOptions
          getOptionLabel={(u) => (u.email ? `${u.name} (${u.email})` : u.name)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, users) => setSelectedOwners(users)}
          onInputChange={(_e, value) => setQuery(value)}
          disabled={saving || programAssigned}
          renderInput={(params) => (
            <TextField
              {...params}
              label="User owners"
              margin="normal"
              helperText={
                programAssigned
                  ? 'Assigning a program owner clears the user owners.'
                  : 'Users who may manage this collection together.'
              }
            />
          )}
        />

        {roleTab === 'student' && (
          <Autocomplete
            multiple
            data-testid="owners-program-filter"
            options={programs}
            value={programs.filter((p) => programFilterIds.includes(p.id))}
            filterSelectedOptions
            getOptionLabel={(p) => p.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_e, ps) => {
              setProgramFilterIds(ps.map((p) => p.id))
              setUserOptions([])
            }}
            disabled={saving || programAssigned}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Filter by program"
                margin="normal"
                helperText="Optional — narrow the student search to selected programs."
              />
            )}
          />
        )}

        <FormControl fullWidth margin="normal">
          <InputLabel id="owners-program-label">Owning program</InputLabel>
          <Select
            labelId="owners-program-label"
            data-testid="owners-program-select"
            label="Owning program"
            value={selectedProgramId}
            onChange={(e) => setSelectedProgramId(e.target.value as number | '')}
            disabled={saving}
          >
            <MenuItem value="">
              <em>None — owned by users</em>
            </MenuItem>
            {programOptions.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          {programOptions.length === 0 && !isAdmin && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              You do not belong to any programs.
            </Typography>
          )}
        </FormControl>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="owners-error">
            {error}
          </Alert>
        )}
        {collection != null && collection.owners.length === 0 && (
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
          data-testid="owners-confirm"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
