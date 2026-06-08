import { useEffect, useMemo, useState } from 'react'
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
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  addGroupInstructorsBulk,
  addGroupMembersBulk,
  fetchPrograms,
  fetchUsersPaged,
  removeGroupInstructor,
  removeGroupMember,
} from '../api'
import type { ApiProgram, ApiUser } from '../api'
import { apiGroupToGroup } from '../groupUtils'
import type { Group } from '../types'

interface GroupMembersDialogProps {
  open: boolean
  onClose: () => void
  group: Group | null
  /** Propagates the updated group (from the API response) back to the parent. */
  onGroupUpdated: (group: Group) => void
}

type TabKey = 'students' | 'instructors'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

/**
 * Lets an instructor (or admin) manage a group's student members and
 * instructor co-owners at scale. Both tabs use a server-side
 * filtered/searched/paginated table (the user list can run to hundreds of
 * rows) with row checkboxes for **bulk add**. The students tab adds
 * multi-select program filter chips (OR semantics); instructors aren't
 * program-gated so that tab has search only.
 *
 * Membership mutations return the full updated group, so we trust the
 * server's member_ids/instructor_ids rather than re-deriving them locally.
 * The backend enforces role constraints (members must be students,
 * instructors must be instructors) and the last-instructor guard.
 */
export default function GroupMembersDialog({
  open,
  onClose,
  group,
  onGroupUpdated,
}: GroupMembersDialogProps) {
  const [tab, setTab] = useState<TabKey>('students')

  // Program filter (students tab only) — multi-select, OR semantics.
  const [programs, setPrograms] = useState<ApiProgram[]>([])
  const [selectedProgramIds, setSelectedProgramIds] = useState<number[]>([])

  // Free-text search, debounced into `q`.
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')

  // Current page of results.
  const [rows, setRows] = useState<ApiUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Checkbox selection (current bulk-add batch) + in-flight flags.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null)

  // Mirror of the group's current membership, kept in sync with the prop.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())
  const [instructorIds, setInstructorIds] = useState<Set<number>>(new Set())

  // Bumped to force a page reload after a mutation (so member flags refresh).
  const [reloadKey, setReloadKey] = useState(0)

  const assignedIds = tab === 'students' ? memberIds : instructorIds

  // Load the program list once per open (only the students tab uses it, but
  // it's cheap and lets us render chips immediately on tab switch).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchPrograms()
      .then((p) => {
        if (!cancelled) setPrograms(p)
      })
      .catch(() => {
        /* non-fatal: the table still works without filter chips */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Keep the local membership sets in sync with the latest group prop,
  // including the updated ids returned after a membership mutation.
  useEffect(() => {
    if (group) {
      setMemberIds(new Set(group.memberIds))
      setInstructorIds(new Set(group.instructorIds))
    }
  }, [group])

  // Reset paging + selection whenever the active filter changes.
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [tab, q, selectedProgramIds])

  // Debounce the search box into `q`.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset transient state when the dialog closes.
  useEffect(() => {
    if (!open) {
      setTab('students')
      setSelectedProgramIds([])
      setSearchInput('')
      setQ('')
      setRows([])
      setTotal(0)
      setPage(0)
      setSelected(new Set())
      setError(null)
    }
  }, [open])

  // Fetch the current page of users for the active tab/filter.
  useEffect(() => {
    if (!open || !group) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchUsersPaged({
      role: tab === 'students' ? 'student' : 'instructor',
      programIds: tab === 'students' ? selectedProgramIds : undefined,
      q: q || undefined,
      page: page + 1,
      pageSize: PAGE_SIZE,
    })
      .then(({ items, total: count }) => {
        if (cancelled) return
        setRows(items)
        setTotal(count)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load users.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `group` is intentionally tracked by id only — a membership mutation
    // flows a new group object with the same id and must not refetch the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.id, tab, q, selectedProgramIds, page, reloadKey])

  const programNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of programs) m.set(p.id, p.name)
    return m
  }, [programs])

  // Rows on this page that aren't already assigned — the ones a checkbox can
  // select for bulk add.
  const selectableRows = rows.filter((r) => !assignedIds.has(r.id))
  const allPageSelected =
    selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id))
  const somePageSelected = selectableRows.some((r) => selected.has(r.id))

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const r of selectableRows) next.delete(r.id)
      } else {
        for (const r of selectableRows) next.add(r.id)
      }
      return next
    })
  }

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleProgram = (id: number) => {
    setSelectedProgramIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleBulkAdd = async () => {
    if (!group || selected.size === 0) return
    const ids = [...selected]
    setBulkPending(true)
    setError(null)
    try {
      const updated =
        tab === 'students'
          ? await addGroupMembersBulk(group.id, ids)
          : await addGroupInstructorsBulk(group.id, ids)
      const mapped = apiGroupToGroup(updated)
      setMemberIds(new Set(mapped.memberIds))
      setInstructorIds(new Set(mapped.instructorIds))
      onGroupUpdated(mapped)
      setSelected(new Set())
      setReloadKey((k) => k + 1)
    } catch {
      setError(
        tab === 'students'
          ? 'Failed to add the selected students to the group.'
          : 'Failed to add the selected instructors to the group.',
      )
    } finally {
      setBulkPending(false)
    }
  }

  const handleRemove = async (user: ApiUser) => {
    if (!group) return
    setPendingRemoveId(user.id)
    setError(null)
    try {
      const updated =
        tab === 'students'
          ? await removeGroupMember(group.id, user.id)
          : await removeGroupInstructor(group.id, user.id)
      const mapped = apiGroupToGroup(updated)
      setMemberIds(new Set(mapped.memberIds))
      setInstructorIds(new Set(mapped.instructorIds))
      onGroupUpdated(mapped)
      setReloadKey((k) => k + 1)
    } catch {
      setError(
        tab === 'students'
          ? 'Failed to remove the student from the group.'
          : 'Failed to remove the instructor (a group must keep at least one).',
      )
    } finally {
      setPendingRemoveId(null)
    }
  }

  const colSpan = tab === 'students' ? 4 : 3

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {group ? `Manage members — ${group.name}` : 'Manage members'}
      </DialogTitle>
      <DialogContent>
        <Tabs
          value={tab}
          onChange={(_, v: TabKey) => setTab(v)}
          sx={{ mb: 2 }}
        >
          <Tab label="Students" value="students" />
          <Tab label="Instructors" value="instructors" />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {tab === 'students' && programs.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Filter by program
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {programs.map((p) => {
                const active = selectedProgramIds.includes(p.id)
                return (
                  <Chip
                    key={p.id}
                    label={p.name}
                    size="small"
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => toggleProgram(p.id)}
                  />
                )
              })}
            </Box>
          </Box>
        )}

        <TextField
          fullWidth
          size="small"
          label="Search name or email"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {selected.size > 0
              ? `${selected.size} selected`
              : `${total} ${tab === 'students' ? 'student' : 'instructor'}${total === 1 ? '' : 's'}`}
          </Typography>
          <Button
            variant="contained"
            size="small"
            disabled={selected.size === 0 || bulkPending}
            onClick={handleBulkAdd}
          >
            {bulkPending
              ? 'Adding…'
              : `Add ${selected.size || ''} to group`.replace('  ', ' ').trim()}
          </Button>
        </Stack>

        <TableContainer sx={{ maxHeight: 360 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={somePageSelected && !allPageSelected}
                    checked={allPageSelected}
                    disabled={selectableRows.length === 0}
                    onChange={toggleSelectAll}
                    inputProps={{ 'aria-label': 'select all on page' }}
                  />
                </TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                {tab === 'students' && <TableCell>Programs</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colSpan} align="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} align="center" sx={{ py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No {tab === 'students' ? 'students' : 'instructors'} match
                      the current filter.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((u) => {
                  const assigned = assignedIds.has(u.id)
                  return (
                    <TableRow key={u.id} hover selected={selected.has(u.id)}>
                      <TableCell padding="checkbox">
                        {assigned ? (
                          <Tooltip
                            title={
                              tab === 'students' ? 'Remove member' : 'Remove co-owner'
                            }
                          >
                            <span>
                              <IconButton
                                size="small"
                                disabled={pendingRemoveId === u.id}
                                onClick={() => handleRemove(u)}
                                aria-label={`remove ${u.name}`}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            checked={selected.has(u.id)}
                            onChange={() => toggleRow(u.id)}
                            inputProps={{ 'aria-label': `select ${u.name}` }}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {u.name}
                        {assigned && (
                          <Chip
                            label={tab === 'students' ? 'Member' : 'Co-owner'}
                            size="small"
                            color="success"
                            variant="outlined"
                            sx={{ ml: 1 }}
                          />
                        )}
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      {tab === 'students' && (
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {u.program_ids.map((pid) => (
                              <Chip
                                key={pid}
                                label={programNameById.get(pid) ?? `#${pid}`}
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Box>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
