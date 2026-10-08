import { useContext, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { fetchUsersPaged, userMessage } from '../api'
import type { ApiUser } from '../api'
import { AuthContext } from '../authContextValue'
import { describeCollectionOwners } from '../collectionUtils'
import type { CollectionSummary, Program } from '../types'
import FilterBar from './FilterBar'
import FilterOptionPanel from './FilterOptionPanel'
import FilterPopoverButton, { filterSurfaceBg } from './FilterPopoverButton'
import FilterTextPanel from './FilterTextPanel'

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
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300
// Fixed floor for the mode-switching area so picking a different radio
// never resizes the dialog. The value is the User-mode section's height at
// the default 25-row page: ~28px description + ~38px filter bar + the
// table's 400px max-height (25 rows far exceed the cap) + ~52px
// pagination ≈ 528px.
const MODE_SECTION_MIN_HEIGHT_PX = 528

type OwnerMode = 'program' | 'user'
type RoleFilter = 'student' | 'instructor' | 'all'

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Owners & transfer (#1531): a User/Program radio row picks which ownership
 * surface to edit. Program mode lists the programs as single-select chips —
 * a filled, deletable chip is the staged owner, and its delete icon reverts
 * it to outlined. User mode mirrors `GroupManagementModal`'s member table
 * (checkbox rows over a role/filter/search-driven `fetchUsersPaged` list);
 * the checked set is the replacement user-owner set. Rendered only where
 * `permissions.canTransfer` allows (admin, or an instructor who owns the
 * collection / belongs to its owning program); the backend re-checks the
 * same matrix on both endpoints.
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

  // The current program owner always renders as a chip even when it is not
  // an assignable option — e.g. an instructor co-owner who left the owning
  // program can still clear its ownership (the backend allows the transfer
  // to null when user owners survive).
  const programChips: Array<{ id: number; name: string }> = (() => {
    const chips: Array<{ id: number; name: string }> = [...programOptions]
    if (currentProgramId != null && !chips.some((p) => p.id === currentProgramId)) {
      const owner = collection?.owners.find((o) => o.kind === 'program')
      if (owner) chips.push({ id: owner.programId, name: owner.name })
    }
    return chips
  })()

  const defaultRole: RoleFilter = isAdmin ? 'all' : 'student'

  // Lazy seeds cover the open-on-mount case; the render-time reset below
  // reseeds on every false→true transition.
  const [mode, setMode] = useState<OwnerMode>(() => (currentProgramId != null ? 'program' : 'user'))
  const [programChoice, setProgramChoice] = useState<number | null>(currentProgramId)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(
    () => new Set(currentUserOwnerIds),
  )
  // Role scope for the user table, mirroring GroupManagementModal: instructors
  // choose between Students and Instructors (admins and staff are never
  // listed to them); admins additionally get an unscoped "Everyone" mode.
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(defaultRole)
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  // Optional program narrowing — the endpoint applies it in every role
  // scope (unlike the group member picker, where it is Students-only).
  const [programFilterIds, setProgramFilterIds] = useState<number[]>([])
  const [rows, setRows] = useState<ApiUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const programNameById = useMemo(() => {
    const names = new Map<number, string>()
    for (const program of programs) names.set(program.id, program.name)
    return names
  }, [programs])

  // Reset on each open transition — render-time adjustment (the Groups
  // pattern) so the seed lands before the first paint, no effect needed.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setMode(currentProgramId != null ? 'program' : 'user')
      setProgramChoice(currentProgramId)
      setSelectedUserIds(new Set(currentUserOwnerIds))
      setRoleFilter(defaultRole)
      setSearchInput('')
      setQ('')
      setProgramFilterIds([])
      setRows([])
      setTotal(0)
      setPage(0)
      setPageSize(DEFAULT_PAGE_SIZE)
      setError(null)
      setSaving(false)
    }
  }

  // Debounced search term (Groups pattern).
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reset pagination when filters change (render-time adjustment, Groups pattern).
  const filterKey = JSON.stringify([roleFilter, q, programFilterIds, pageSize])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(0)
  }

  // Paged people search — the same endpoint the group-membership picker
  // uses, so instructors see the scoped mini-projection automatically.
  // Program narrowing applies in every role scope here; "Everyone"
  // (admins only) sends no role param. Runs in User mode only.
  useEffect(() => {
    if (!open || mode !== 'user') return
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading indicator at effect start is standard fetch pattern
    fetchUsersPaged({
      role: roleFilter === 'all' ? undefined : roleFilter,
      programIds: programFilterIds.length > 0 ? programFilterIds : undefined,
      q: q || undefined,
      page: page + 1,
      pageSize,
    })
      .then(({ items, total: count }) => {
        if (cancelled) return
        // Inactive accounts cannot hold owner rows (backend 422s them).
        setRows(items.filter((u) => u.active))
        setTotal(count)
      })
      .catch(() => {
        if (!cancelled) {
          setRows([])
          setTotal(0)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, mode, q, roleFilter, programFilterIds, page, pageSize])

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  // Current owners render from the collection itself, not the fetched
  // page — an owner who is inactive or outside the viewer's directory
  // scope must stay removable, or their id would linger in the staged set
  // and 422 the PUT.
  const currentOwnerUsers = (collection?.owners ?? []).filter((o) => o.kind === 'user')
  const fetchedById = new Map(rows.map((row) => [row.id, row]))
  const otherRows = rows.filter((row) => !currentUserOwnerIds.includes(row.id))
  const allPageSelected = rows.length > 0 && rows.every((row) => selectedUserIds.has(row.id))
  const somePageSelected = rows.some((row) => selectedUserIds.has(row.id))
  const toggleSelectAll = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const row of rows) next.delete(row.id)
      } else {
        for (const row of rows) next.add(row.id)
      }
      return next
    })
  }

  const ownersChanged = !sameIds([...selectedUserIds], currentUserOwnerIds)
  const programChanged = programChoice !== currentProgramId
  // Clearing the program needs surviving user owners; an empty dialog-wide
  // owner set is what the backend's orphan guard rejects (422).
  const programWouldOrphan = programChoice == null && currentUserOwnerIds.length === 0
  const userWouldOrphan = selectedUserIds.size === 0 && currentProgramId == null
  const canConfirm =
    collection != null &&
    !saving &&
    (mode === 'program' ? programChanged && !programWouldOrphan : ownersChanged && !userWouldOrphan)

  const handleConfirm = () => {
    if (collection == null) return
    setSaving(true)
    setError(null)
    const id = collection.id
    const job =
      mode === 'program'
        ? () => onTransfer(id, programChoice)
        : () => onSaveOwners(id, [...selectedUserIds])
    job()
      .then(() => onClose())
      .catch((err) => setError(userMessage(err, 'Failed to update ownership.')))
      .finally(() => setSaving(false))
  }

  const hasActiveUserFilters = searchInput.trim().length > 0 || programFilterIds.length > 0
  const selectedProgramFilters = programs.filter((p) => programFilterIds.includes(p.id))

  const renderOwnerRow = (owner: { userId: number; name: string }) => {
    const fetched = fetchedById.get(owner.userId)
    return (
      <TableRow
        key={owner.userId}
        hover
        onClick={() => toggleUser(owner.userId)}
        sx={{ cursor: 'pointer' }}
      >
        <TableCell padding="checkbox">
          <Checkbox
            checked={selectedUserIds.has(owner.userId)}
            onClick={(event) => event.stopPropagation()}
            onChange={() => toggleUser(owner.userId)}
            inputProps={{ 'aria-label': `select ${owner.name}` }}
          />
        </TableCell>
        <TableCell>
          <Stack direction="row" alignItems="center" spacing={1}>
            <span>{owner.name}</span>
            <Chip
              label="Owner"
              size="small"
              color="success"
              variant="outlined"
              sx={{ height: 20 }}
            />
          </Stack>
        </TableCell>
        <TableCell>{fetched?.email ?? '—'}</TableCell>
        <TableCell>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {fetched?.program_ids.map((programId) => (
              <Chip
                key={programId}
                data-testid="program-chip"
                label={programNameById.get(programId) ?? `#${programId}`}
                size="small"
                color="primary"
              />
            ))}
          </Stack>
        </TableCell>
      </TableRow>
    )
  }

  const renderUserRow = (user: ApiUser) => (
    <TableRow key={user.id} hover onClick={() => toggleUser(user.id)} sx={{ cursor: 'pointer' }}>
      <TableCell padding="checkbox">
        <Checkbox
          checked={selectedUserIds.has(user.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleUser(user.id)}
          inputProps={{ 'aria-label': `select ${user.name}` }}
        />
      </TableCell>
      <TableCell>{user.name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          {user.program_ids.map((programId) => (
            <Chip
              key={programId}
              data-testid="program-chip"
              label={programNameById.get(programId) ?? `#${programId}`}
              size="small"
              color="primary"
            />
          ))}
        </Stack>
      </TableCell>
    </TableRow>
  )

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="collection-owners-title"
    >
      <DialogTitle id="collection-owners-title">Owners</DialogTitle>
      <DialogContent>
        {collection && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            <strong>{collection.name}</strong> is currently owned by{' '}
            {describeCollectionOwners(collection.owners)}.
          </Typography>
        )}

        <RadioGroup
          row
          aria-label="Ownership type"
          value={mode}
          onChange={(e) => setMode(e.target.value as OwnerMode)}
        >
          <FormControlLabel
            value="user"
            control={<Radio size="small" />}
            label="User"
            disabled={saving}
          />
          <FormControlLabel
            value="program"
            control={<Radio size="small" />}
            label="Program"
            disabled={saving}
          />
        </RadioGroup>

        {mode === 'program' ? (
          <Box
            data-testid="owners-mode-section"
            sx={{ mt: 1, minHeight: MODE_SECTION_MIN_HEIGHT_PX }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Select a program to own this collection.
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {programChips.map((program) => {
                const selected = programChoice === program.id
                return (
                  <Chip
                    key={program.id}
                    label={program.name}
                    variant={selected ? 'filled' : 'outlined'}
                    color={selected ? 'primary' : 'default'}
                    onClick={selected || saving ? undefined : () => setProgramChoice(program.id)}
                    onDelete={selected && !saving ? () => setProgramChoice(null) : undefined}
                    data-testid={`program-choice-${program.id}`}
                  />
                )
              })}
            </Stack>
            {programChips.length === 0 && !isAdmin && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }} display="block">
                You do not belong to any programs.
              </Typography>
            )}
            {programChoice != null && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }} display="block">
                Assigning a program owner clears the user owners.
              </Typography>
            )}
          </Box>
        ) : (
          <Box
            data-testid="owners-mode-section"
            sx={{ mt: 1, minHeight: MODE_SECTION_MIN_HEIGHT_PX }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Users who may manage this collection together.
            </Typography>
            <FilterBar
              ariaLabel="Filter users"
              clearAction={
                hasActiveUserFilters ? (
                  <Button
                    size="small"
                    color="secondary"
                    onClick={() => {
                      setSearchInput('')
                      setQ('')
                      setProgramFilterIds([])
                    }}
                    sx={{
                      minWidth: 0,
                      px: 0,
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Clear all
                  </Button>
                ) : undefined
              }
              summary={
                hasActiveUserFilters ? (
                  <>
                    {searchInput.trim().length > 0 && (
                      <Chip
                        label={`Search: ${searchInput.trim()}`}
                        size="small"
                        onDelete={() => {
                          setSearchInput('')
                          setQ('')
                        }}
                        sx={{
                          bgcolor: (theme) =>
                            theme.palette.mode === 'dark'
                              ? 'rgba(165, 36, 56, 0.22)'
                              : 'rgba(165, 36, 56, 0.08)',
                          color: 'secondary.main',
                          border: '1px solid',
                          borderColor: 'secondary.main',
                          '& .MuiChip-deleteIcon': { color: 'secondary.main' },
                        }}
                      />
                    )}
                    {selectedProgramFilters.map((program) => (
                      <Chip
                        key={program.id}
                        label={`Program: ${program.name}`}
                        size="small"
                        onDelete={() =>
                          setProgramFilterIds((prev) => prev.filter((id) => id !== program.id))
                        }
                        sx={{
                          bgcolor: (theme) =>
                            theme.palette.mode === 'dark'
                              ? 'rgba(165, 36, 56, 0.22)'
                              : 'rgba(165, 36, 56, 0.08)',
                          color: 'secondary.main',
                          border: '1px solid',
                          borderColor: 'secondary.main',
                          '& .MuiChip-deleteIcon': { color: 'secondary.main' },
                        }}
                      />
                    ))}
                  </>
                ) : undefined
              }
            >
              <FilterPopoverButton
                label="Role"
                activeCount={roleFilter === defaultRole ? 0 : 1}
                panelWidth={220}
              >
                <FilterOptionPanel
                  multiple={false}
                  options={[
                    { value: 'student', label: 'Students' },
                    { value: 'instructor', label: 'Instructors' },
                    ...(isAdmin ? [{ value: 'all', label: 'Everyone' }] : []),
                  ]}
                  selectedValues={[roleFilter]}
                  onChange={(values) => {
                    const next = values[0] as RoleFilter | undefined
                    if (next != null) setRoleFilter(next)
                  }}
                />
              </FilterPopoverButton>
              <FilterPopoverButton
                label="Search"
                activeCount={searchInput.trim().length > 0 ? 1 : 0}
                panelWidth={280}
              >
                <FilterTextPanel
                  value={searchInput}
                  onChange={setSearchInput}
                  placeholder="Search name or email"
                  ariaLabel="Name or email"
                  width={280}
                />
              </FilterPopoverButton>
              {programs.length > 0 && (
                <FilterPopoverButton
                  label="Program"
                  activeCount={selectedProgramFilters.length}
                  panelWidth={280}
                >
                  <FilterOptionPanel
                    options={programs.map((program) => ({
                      value: String(program.id),
                      label: program.name,
                    }))}
                    selectedValues={programFilterIds.map(String)}
                    onChange={(values) => setProgramFilterIds(values.map((value) => Number(value)))}
                  />
                </FilterPopoverButton>
              )}
            </FilterBar>

            <TableContainer sx={{ maxHeight: 400 }}>
              <Table stickyHeader size="small">
                <TableHead
                  sx={{ '& .MuiTableCell-head': { bgcolor: (theme) => filterSurfaceBg(theme) } }}
                >
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={allPageSelected}
                        indeterminate={somePageSelected && !allPageSelected}
                        disabled={rows.length === 0}
                        onChange={toggleSelectAll}
                        inputProps={{ 'aria-label': 'select all users on page' }}
                      />
                    </TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Program</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {currentOwnerUsers.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 0.5 }}>
                          <Typography variant="caption" fontWeight={600} color="text.secondary">
                            CURRENT OWNERS
                          </Typography>
                        </TableCell>
                      </TableRow>
                      {currentOwnerUsers.map((owner) => renderOwnerRow(owner))}
                    </>
                  )}
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                        <CircularProgress size={24} />
                      </TableCell>
                    </TableRow>
                  ) : (
                    otherRows.length > 0 && (
                      <>
                        <TableRow>
                          <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 0.5 }}>
                            <Typography variant="caption" fontWeight={600} color="text.secondary">
                              AVAILABLE USERS
                            </Typography>
                          </TableCell>
                        </TableRow>
                        {otherRows.map((user) => renderUserRow(user))}
                      </>
                    )
                  )}
                  {!loading && currentOwnerUsers.length === 0 && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                        <Typography color="text.secondary">No users found.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, nextPage) => setPage(nextPage)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(0)
              }}
              rowsPerPageOptions={PAGE_SIZE_OPTIONS}
            />
          </Box>
        )}

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
          color="secondary"
          onClick={handleConfirm}
          disabled={!canConfirm}
          data-testid="owners-confirm"
        >
          {saving ? 'Saving…' : mode === 'program' ? 'Change Owner' : 'Change Owner(s)'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
