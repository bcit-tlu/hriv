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
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
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
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { alpha, useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PeopleIcon from '@mui/icons-material/People'
import SearchIcon from '@mui/icons-material/Search'
import {
  addGroupInstructorsBulk,
  addGroupMembersBulk,
  fetchPrograms,
  fetchUsersPaged,
  attachedCategoriesFromError,
  removeGroupInstructor,
  removeGroupMember,
  userMessage,
} from '../api'
import type { ApiProgram, ApiUser } from '../api'
import { apiGroupToGroup } from '../groupUtils'
import { getGroupChipColors } from '../theme'
import type { Group } from '../types'

interface GroupManagementModalProps {
  open: boolean
  onClose: () => void
  groups: Group[]
  onAdd: (name: string, description: string | null) => void | Promise<void>
  onEdit: (id: number, name: string, description: string | null) => void | Promise<void>
  onDelete: (id: number) => void | Promise<void>
  /** Propagates membership updates back to the parent app state. */
  onGroupUpdated?: (group: Group) => void
  /**
   * Whether the current user may rename/delete/manage members of a group.
   * Admins manage all groups; instructors only the ones they co-own. The
   * backend enforces this too, but gating the UI avoids 403s on no-op clicks.
   */
  canManage: (group: Group) => boolean
}

type TabKey = 'students' | 'instructors'
type GroupDialogMode = 'create' | 'rename' | null

const PAGE_SIZE_OPTIONS = [10, 25, 50]
const DEFAULT_PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300

export default function GroupManagementModal({
  open,
  onClose,
  groups,
  onAdd,
  onEdit,
  onDelete,
  canManage,
  onGroupUpdated,
}: GroupManagementModalProps) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'))
  const groupColors = getGroupChipColors(theme.palette.mode)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  const [groupDialogMode, setGroupDialogMode] = useState<GroupDialogMode>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('')
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteBlockedCategories, setDeleteBlockedCategories] = useState<
    { id: number; label: string }[]
  >([])
  const [deleteBlockedCategoriesExpanded, setDeleteBlockedCategoriesExpanded] = useState(false)

  const [tab, setTab] = useState<TabKey>('students')
  const [programs, setPrograms] = useState<ApiProgram[]>([])
  const [selectedProgramIds, setSelectedProgramIds] = useState<number[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ApiUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [groupActionError, setGroupActionError] = useState<string | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null)
  const [groupPending, setGroupPending] = useState(false)
  const [optimisticGroups, setOptimisticGroups] = useState<Map<number, Group>>(() => new Map())

  const displayGroups = useMemo(
    () => groups.map((group) => optimisticGroups.get(group.id) ?? group),
    [groups, optimisticGroups],
  )

  const selectedGroup = useMemo(
    () => displayGroups.find((group) => group.id === selectedGroupId) ?? null,
    [displayGroups, selectedGroupId],
  )
  const selectedGroupIdForFetch = selectedGroup?.id ?? null

  // Reset optimistic state when server groups change (render-time adjustment)
  const [prevGroups, setPrevGroups] = useState(groups)
  if (groups !== prevGroups) {
    setPrevGroups(groups)
    setOptimisticGroups(new Map())
  }

  // Ensure selectedGroupId stays valid when displayGroups changes
  if (open) {
    if (displayGroups.length === 0 && selectedGroupId !== null) {
      setSelectedGroupId(null)
    } else if (
      displayGroups.length > 0 &&
      (selectedGroupId == null || !displayGroups.some((group) => group.id === selectedGroupId))
    ) {
      setSelectedGroupId(displayGroups[0].id)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchPrograms()
      .then((programList) => {
        if (!cancelled) setPrograms(programList)
      })
      .catch(() => {
        /* Non-fatal: member search still works without filter chips. */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reset pagination when filters change (render-time adjustment)
  const filterKey = JSON.stringify([tab, q, selectedProgramIds, selectedGroupId, pageSize])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(0)
    setSelectedUserIds(new Set())
  }

  // Reset all local state when modal closes (render-time adjustment)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setMobileDetailOpen(false)
      setGroupDialogMode(null)
      setGroupNameDraft('')
      setGroupDescriptionDraft('')
      setMenuAnchorEl(null)
      setMenuGroupId(null)
      setDeleteDialogOpen(false)
      setDeleteBlockedCategories([])
      setDeleteBlockedCategoriesExpanded(false)
      setTab('students')
      setSelectedProgramIds([])
      setSearchInput('')
      setQ('')
      setRows([])
      setTotal(0)
      setPage(0)
      setPageSize(DEFAULT_PAGE_SIZE)
      setSelectedUserIds(new Set())
      setMemberError(null)
      setGroupActionError(null)
      setOptimisticGroups(new Map())
    }
  }

  useEffect(() => {
    if (!open || selectedGroupIdForFetch == null) {
      return undefined
    }
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading indicator at effect start is standard fetch pattern
    setMemberError(null)
    fetchUsersPaged({
      role: tab === 'students' ? 'student' : 'instructor',
      programIds: tab === 'students' ? selectedProgramIds : undefined,
      q: q || undefined,
      page: page + 1,
      pageSize,
    })
      .then(({ items, total: count }) => {
        if (cancelled) return
        setRows(items)
        setTotal(count)
      })
      .catch(() => {
        if (!cancelled) setMemberError('Failed to load users.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedGroupIdForFetch, tab, q, selectedProgramIds, page, pageSize])

  const memberIds = useMemo(() => new Set(selectedGroup?.memberIds ?? []), [selectedGroup])
  const instructorIds = useMemo(() => new Set(selectedGroup?.instructorIds ?? []), [selectedGroup])
  const assignedIds = tab === 'students' ? memberIds : instructorIds
  const manageable = selectedGroup ? canManage(selectedGroup) : false

  const programNameById = useMemo(() => {
    const names = new Map<number, string>()
    for (const program of programs) names.set(program.id, program.name)
    return names
  }, [programs])

  const currentRows = rows.filter((row) => assignedIds.has(row.id))
  const availableRows = rows.filter((row) => !assignedIds.has(row.id))
  const allAvailableSelected =
    availableRows.length > 0 && availableRows.every((row) => selectedUserIds.has(row.id))
  const someAvailableSelected = availableRows.some((row) => selectedUserIds.has(row.id))
  const colSpan = tab === 'students' ? 5 : 4

  const openCreateDialog = () => {
    setGroupNameDraft('')
    setGroupDescriptionDraft('')
    setGroupActionError(null)
    setGroupDialogMode('create')
  }

  const openGroupMenu = (event: React.MouseEvent<HTMLElement>, groupId: number) => {
    event.stopPropagation()
    setMenuAnchorEl(event.currentTarget)
    setMenuGroupId(groupId)
  }

  const closeGroupMenu = () => {
    setMenuAnchorEl(null)
  }

  const startRename = () => {
    const group = displayGroups.find((item) => item.id === menuGroupId)
    if (group) {
      setGroupNameDraft(group.name)
      setGroupDescriptionDraft(group.description ?? '')
      setGroupActionError(null)
      setGroupDialogMode('rename')
    }
    closeGroupMenu()
  }

  const startDelete = () => {
    setGroupActionError(null)
    setDeleteBlockedCategories([])
    setDeleteBlockedCategoriesExpanded(false)
    setDeleteDialogOpen(true)
    closeGroupMenu()
  }

  const handleGroupDialogSubmit = async () => {
    const name = groupNameDraft.trim()
    const description = groupDescriptionDraft.trim() || null
    if (!name) return
    setGroupPending(true)
    setGroupActionError(null)
    try {
      if (groupDialogMode === 'create') {
        await Promise.resolve(onAdd(name, description))
      } else if (groupDialogMode === 'rename' && menuGroupId != null) {
        const group = displayGroups.find((item) => item.id === menuGroupId)
        await Promise.resolve(onEdit(menuGroupId, name, description))
        if (group) {
          setOptimisticGroup({ ...group, name, description })
        }
      }
      setGroupDialogMode(null)
      setGroupNameDraft('')
      setGroupDescriptionDraft('')
    } catch (err) {
      setGroupActionError(
        userMessage(
          err,
          groupDialogMode === 'create' ? 'Failed to create group.' : 'Failed to rename group.',
        ),
      )
    } finally {
      setGroupPending(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (menuGroupId == null) return
    setGroupPending(true)
    setGroupActionError(null)
    try {
      await Promise.resolve(onDelete(menuGroupId))
      if (selectedGroupId === menuGroupId) {
        const nextGroup = displayGroups.find((group) => group.id !== menuGroupId)
        setSelectedGroupId(nextGroup?.id ?? null)
      }
      setDeleteDialogOpen(false)
      setMenuGroupId(null)
      setDeleteBlockedCategories([])
      setDeleteBlockedCategoriesExpanded(false)
    } catch (err) {
      setGroupActionError(userMessage(err, 'Failed to delete group.'))
      setDeleteBlockedCategories(attachedCategoriesFromError(err) ?? [])
      setDeleteBlockedCategoriesExpanded(false)
    } finally {
      setGroupPending(false)
    }
  }

  const selectGroup = (groupId: number) => {
    setSelectedGroupId(groupId)
    setMobileDetailOpen(true)
  }

  const toggleProgram = (programId: number) => {
    setSelectedProgramIds((prev) =>
      prev.includes(programId) ? prev.filter((id) => id !== programId) : [...prev, programId],
    )
  }

  const toggleSelectAllAvailable = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (allAvailableSelected) {
        for (const row of availableRows) next.delete(row.id)
      } else {
        for (const row of availableRows) next.add(row.id)
      }
      return next
    })
  }

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const setOptimisticGroup = (updated: Group) => {
    setOptimisticGroups((prev) => {
      const next = new Map(prev)
      next.set(updated.id, updated)
      return next
    })
  }

  const updateGroupFromApi = (updated: Group) => {
    setOptimisticGroup(updated)
    onGroupUpdated?.(updated)
  }

  const handleBulkAdd = async () => {
    if (!selectedGroup || selectedUserIds.size === 0) return
    const ids = [...selectedUserIds]
    setBulkPending(true)
    setMemberError(null)
    try {
      const updatedGroup =
        tab === 'students'
          ? await addGroupMembersBulk(selectedGroup.id, ids)
          : await addGroupInstructorsBulk(selectedGroup.id, ids)
      updateGroupFromApi(apiGroupToGroup(updatedGroup))
      setSelectedUserIds(new Set())
    } catch (err) {
      setMemberError(
        userMessage(
          err,
          tab === 'students'
            ? 'Failed to add the selected students to the group.'
            : 'Failed to add the selected instructors to the group.',
        ),
      )
    } finally {
      setBulkPending(false)
    }
  }

  const handleRemove = async (user: ApiUser) => {
    if (!selectedGroup) return
    setPendingRemoveId(user.id)
    setMemberError(null)
    try {
      const updatedGroup =
        tab === 'students'
          ? await removeGroupMember(selectedGroup.id, user.id)
          : await removeGroupInstructor(selectedGroup.id, user.id)
      updateGroupFromApi(apiGroupToGroup(updatedGroup))
    } catch (err) {
      setMemberError(
        userMessage(
          err,
          tab === 'students'
            ? 'Failed to remove the student from the group.'
            : 'Failed to remove the instructor (a group must keep at least one).',
        ),
      )
    } finally {
      setPendingRemoveId(null)
    }
  }

  const renderUserRow = (user: ApiUser, assigned: boolean) => (
    <TableRow
      key={user.id}
      hover
      onClick={assigned || !manageable ? undefined : () => toggleUser(user.id)}
      sx={{ cursor: assigned || !manageable ? 'default' : 'pointer' }}
    >
      <TableCell padding="checkbox">
        <Checkbox
          checked={assigned || selectedUserIds.has(user.id)}
          disabled={assigned || !manageable}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleUser(user.id)}
          inputProps={{ 'aria-label': `select ${user.name}` }}
        />
      </TableCell>
      <TableCell>
        <Stack direction="row" alignItems="center" spacing={1}>
          <span>{user.name}</span>
          {assigned && (
            <Chip
              label={tab === 'students' ? 'Member' : 'Co-owner'}
              size="small"
              color="success"
              variant="outlined"
              sx={{ height: 20 }}
            />
          )}
        </Stack>
      </TableCell>
      <TableCell>{user.email}</TableCell>
      {tab === 'students' && (
        <TableCell>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {user.program_ids.map((programId) => (
              <Chip
                key={programId}
                label={programNameById.get(programId) ?? `#${programId}`}
                size="small"
                color="primary"
              />
            ))}
          </Stack>
        </TableCell>
      )}
      <TableCell align="right" width={48}>
        {assigned && manageable && (
          <Button
            size="small"
            color="error"
            disabled={pendingRemoveId === user.id}
            onClick={(event) => {
              event.stopPropagation()
              void handleRemove(user)
            }}
          >
            Remove
          </Button>
        )}
      </TableCell>
    </TableRow>
  )

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        fullScreen={fullScreen}
        PaperProps={{
          sx: {
            height: fullScreen ? '100%' : '85vh',
            maxHeight: fullScreen ? '100%' : 900,
          },
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" component="span">
              Manage Groups
            </Typography>
            <IconButton edge="end" onClick={onClose} aria-label="close groups dialog">
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              width: { xs: '100%', md: 320 },
              borderRight: { md: 1 },
              borderColor: 'divider',
              display: { xs: mobileDetailOpen && selectedGroup ? 'none' : 'flex', md: 'flex' },
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <Box sx={{ p: 2, pb: 1.5 }}>
              <Button
                variant="contained"
                color="secondary"
                fullWidth
                startIcon={<AddIcon />}
                onClick={openCreateDialog}
                sx={{ mb: 1.5 }}
              >
                Create Group
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                {displayGroups.length} {displayGroups.length === 1 ? 'group' : 'groups'}
              </Typography>
            </Box>
            <Divider />
            {displayGroups.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No groups yet. Create a group to start adding students and instructors.
                </Typography>
              </Box>
            ) : (
              <List sx={{ flex: 1, overflow: 'auto', px: 1, py: 1 }}>
                {displayGroups.map((group) => {
                  const isSelected = group.id === selectedGroupId
                  const groupManageable = canManage(group)
                  return (
                    <ListItemButton
                      key={group.id}
                      selected={isSelected}
                      onClick={() => selectGroup(group.id)}
                      sx={{
                        borderRadius: 1,
                        mb: 0.5,
                        '&.Mui-selected': {
                          bgcolor: groupColors.subtleBg,
                          color: groupColors.subtleText,
                          '&:hover': { bgcolor: groupColors.subtleBg },
                          '& .MuiListItemText-secondary': {
                            color: alpha(groupColors.subtleText, 0.72),
                          },
                        },
                      }}
                    >
                      <ListItemText
                        primary={group.name}
                        secondary={
                          <Box
                            component="span"
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}
                          >
                            <PeopleIcon sx={{ fontSize: 14 }} />
                            {group.memberIds.length + group.instructorIds.length} members
                          </Box>
                        }
                      />
                      <IconButton
                        edge="end"
                        size="small"
                        disabled={!groupManageable}
                        onClick={(event) => openGroupMenu(event, group.id)}
                        aria-label={`group actions for ${group.name}`}
                        sx={{ color: isSelected ? 'inherit' : 'text.secondary' }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </ListItemButton>
                  )
                })}
              </List>
            )}
          </Box>

          <Box
            sx={{
              flex: 1,
              display: { xs: mobileDetailOpen && selectedGroup ? 'flex' : 'none', md: 'flex' },
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {selectedGroup ? (
              <>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <IconButton
                      sx={{ display: { md: 'none' } }}
                      onClick={() => setMobileDetailOpen(false)}
                      aria-label="back to groups"
                    >
                      <ArrowBackIcon />
                    </IconButton>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" noWrap>
                        {selectedGroup.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {selectedGroup.memberIds.length} students ·{' '}
                        {selectedGroup.instructorIds.length} instructors
                      </Typography>
                      {selectedGroup.description && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {selectedGroup.description}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Box>

                <Tabs
                  value={tab}
                  onChange={(_, value: TabKey) => setTab(value)}
                  sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
                >
                  <Tab label={`Students (${selectedGroup.memberIds.length})`} value="students" />
                  <Tab
                    label={`Instructors (${selectedGroup.instructorIds.length})`}
                    value="instructors"
                  />
                </Tabs>

                <Box sx={{ px: 2, pt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  {memberError && (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                      {memberError}
                    </Alert>
                  )}
                  {!manageable && (
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                      You can view this group, but only group co-owners and admins can change its
                      membership.
                    </Alert>
                  )}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Search name or email"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={bulkPending ? <CircularProgress size={16} /> : <AddIcon />}
                      disabled={selectedUserIds.size === 0 || bulkPending || !manageable}
                      onClick={() => void handleBulkAdd()}
                      sx={{ minWidth: 160, whiteSpace: 'nowrap' }}
                    >
                      Add {selectedUserIds.size > 0 ? selectedUserIds.size : ''} to Group
                    </Button>
                  </Stack>
                  {tab === 'students' && programs.length > 0 && (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mb: 0.75 }}
                      >
                        Filter by program
                      </Typography>
                      <Stack direction="row" flexWrap="wrap" gap={0.75}>
                        {programs.map((program) => {
                          const active = selectedProgramIds.includes(program.id)
                          return (
                            <Chip
                              key={program.id}
                              label={program.name}
                              onClick={() => toggleProgram(program.id)}
                              color={active ? 'primary' : 'default'}
                              variant={active ? 'filled' : 'outlined'}
                              size="small"
                            />
                          )
                        })}
                      </Stack>
                    </Box>
                  )}
                </Box>

                <TableContainer sx={{ flex: 1, minHeight: 0 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={allAvailableSelected}
                            indeterminate={someAvailableSelected && !allAvailableSelected}
                            disabled={availableRows.length === 0 || !manageable}
                            onChange={toggleSelectAllAvailable}
                            inputProps={{ 'aria-label': 'select all available users on page' }}
                          />
                        </TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Email</TableCell>
                        {tab === 'students' && <TableCell>Programs</TableCell>}
                        <TableCell width={48} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={colSpan} align="center" sx={{ py: 8 }}>
                            <CircularProgress size={24} />
                          </TableCell>
                        </TableRow>
                      ) : rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={colSpan} align="center" sx={{ py: 8 }}>
                            <Typography color="text.secondary">
                              No {tab === 'students' ? 'students' : 'instructors'} found.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {currentRows.length > 0 && (
                            <>
                              <TableRow>
                                <TableCell
                                  colSpan={colSpan}
                                  sx={{ bgcolor: 'action.hover', py: 0.5 }}
                                >
                                  <Typography
                                    variant="caption"
                                    fontWeight={600}
                                    color="text.secondary"
                                  >
                                    {tab === 'students' ? 'CURRENT MEMBERS' : 'CO-OWNERS'}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                              {currentRows.map((user) => renderUserRow(user, true))}
                            </>
                          )}
                          {availableRows.length > 0 && (
                            <>
                              <TableRow>
                                <TableCell
                                  colSpan={colSpan}
                                  sx={{ bgcolor: 'action.hover', py: 0.5 }}
                                >
                                  <Typography
                                    variant="caption"
                                    fontWeight={600}
                                    color="text.secondary"
                                  >
                                    {tab === 'students'
                                      ? 'AVAILABLE STUDENTS'
                                      : 'AVAILABLE INSTRUCTORS'}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                              {availableRows.map((user) => renderUserRow(user, false))}
                            </>
                          )}
                        </>
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
              </>
            ) : (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 3,
                  color: 'text.secondary',
                  textAlign: 'center',
                }}
              >
                <Typography>Select a group to manage students and instructors.</Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      <Menu anchorEl={menuAnchorEl} open={Boolean(menuAnchorEl)} onClose={closeGroupMenu}>
        <MenuItem onClick={startRename}>Rename</MenuItem>
        <MenuItem onClick={startDelete} sx={{ color: 'error.main' }}>
          Delete
        </MenuItem>
      </Menu>

      <Dialog
        open={groupDialogMode != null}
        onClose={() => {
          setGroupDialogMode(null)
          setGroupActionError(null)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {groupDialogMode === 'create' ? 'Create New Group' : 'Rename Group'}
        </DialogTitle>
        <DialogContent>
          {groupActionError && (
            <Alert severity="error" sx={{ mt: 1, mb: 1 }}>
              {groupActionError}
            </Alert>
          )}
          <TextField
            autoFocus
            fullWidth
            label="Group name"
            value={groupNameDraft}
            onChange={(event) => setGroupNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleGroupDialogSubmit()
              if (event.key === 'Escape') setGroupDialogMode(null)
            }}
            sx={{ mt: 1 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Description (optional)"
            value={groupDescriptionDraft}
            onChange={(event) => setGroupDescriptionDraft(event.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setGroupDialogMode(null)
              setGroupActionError(null)
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!groupNameDraft.trim() || groupPending}
            onClick={() => void handleGroupDialogSubmit()}
          >
            {groupDialogMode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false)
          setGroupActionError(null)
          setDeleteBlockedCategories([])
          setDeleteBlockedCategoriesExpanded(false)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Group</DialogTitle>
        <DialogContent>
          {groupActionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {groupActionError}
            </Alert>
          )}
          {deleteBlockedCategories.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setDeleteBlockedCategoriesExpanded((expanded) => !expanded)}
                aria-expanded={deleteBlockedCategoriesExpanded}
                aria-controls="delete-group-blocked-categories"
              >
                What categories are restricted by this group?
              </Link>
              {deleteBlockedCategoriesExpanded && (
                <List
                  id="delete-group-blocked-categories"
                  dense
                  disablePadding
                  sx={{ mt: 1, pl: 2.5 }}
                >
                  {deleteBlockedCategories.map((category) => (
                    <ListItem key={category.id} component="li" disableGutters>
                      <ListItemText primary={category.label} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will remove all student and instructor associations for this group. Categories that
            use this group may also be affected.
          </Alert>
          <Typography>Are you sure you want to delete this group?</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false)
              setGroupActionError(null)
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={groupPending}
            onClick={() => void handleDeleteConfirm()}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
