import { useEffect, useState, useCallback, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
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
import Snackbar from '@mui/material/Snackbar'
import FormControl from '@mui/material/FormControl'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import ClearIcon from '@mui/icons-material/Clear'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  bulkUpdateUserProgram,
  bulkUpdateUserRole,
  bulkDeleteUsers,
  addGroupMembersBulk,
  userMessage,
} from '../api'
import type { ApiUser } from '../api'
import type { Role, Program, Group } from '../types'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import AddEditPersonModal from './AddEditPersonModal'
import BulkEditModal from './BulkEditModal'
import BulkGroupModal from './BulkGroupModal'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import FilterBar from './FilterBar'

type SortableColumn =
  | 'id'
  | 'name'
  | 'email'
  | 'role'
  | 'program'
  | 'group'
  | 'last_access'
  | 'created_at'
type SortDirection = 'asc' | 'desc'
type PeopleTableColumn =
  | 'id'
  | 'name'
  | 'email'
  | 'role'
  | 'program'
  | 'group'
  | 'last_access'
  | 'created_at'

const ROLES: Role[] = ['admin', 'instructor', 'student']
const PEOPLE_COLUMN_OPTIONS: readonly ColumnVisibilityOption<PeopleTableColumn>[] = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'program', label: 'Program' },
  { key: 'group', label: 'Groups' },
  { key: 'last_access', label: 'Last Accessed' },
  { key: 'created_at', label: 'Created' },
]

const PEOPLE_DEFAULT_VISIBLE_COLUMNS: readonly PeopleTableColumn[] = [
  'name',
  'email',
  'role',
  'program',
  'group',
  'last_access',
]
const PEOPLE_ALL_COLUMNS: readonly PeopleTableColumn[] = PEOPLE_COLUMN_OPTIONS.map(
  (column) => column.key,
)

const PEOPLE_COLUMN_FILTER_KEYS: Partial<Record<PeopleTableColumn, string>> = {
  name: 'name',
  email: 'email',
  role: 'role',
}

type AppliedPeopleFilter =
  | { key: 'name' | 'email' | 'role'; label: string }
  | { key: `program:${number}`; label: string; programId: number }
  | { key: `group:${number}`; label: string; groupId: number }

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [
    ...new Set(Array.from(values, (value) => value.trim()).filter((value) => value.length > 0)),
  ].sort((a, b) => a.localeCompare(b))
}

interface PeoplePageProps {
  programs: Program[]
  groups: Group[]
  initialEditUserId?: number | null
  onEditUserHandled?: () => void
}

export default function PeoplePage({
  programs,
  groups,
  initialEditUserId,
  onEditUserHandled,
}: PeoplePageProps) {
  const [users, setUsers] = useState<ApiUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Sort state
  const [sortColumn, setSortColumn] = useState<SortableColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Filter state — text filters for name/email/role, chip sets for program/group
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selectedPrograms, setSelectedPrograms] = useState<Set<number>>(new Set())
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set())
  const hasActiveFilters =
    Object.values(filters).some((v) => v !== '') ||
    selectedPrograms.size > 0 ||
    selectedGroups.size > 0

  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const { visibleColumns, isColumnVisible, setColumnVisible } =
    useTableColumnPreferences<PeopleTableColumn>({
      tableKey: 'people',
      allColumns: PEOPLE_ALL_COLUMNS,
      defaultVisibleColumns: PEOPLE_DEFAULT_VISIBLE_COLUMNS,
    })

  // Pagination state
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [currentPage, setCurrentPage] = useState(0)

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false)

  // Bulk role dialog
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false)
  const [bulkRole, setBulkRole] = useState<string>('student')

  // Bulk delete confirmation
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // Individual delete confirmation (separate open flag preserves content during exit animation)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<ApiUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)

  // Success snackbar
  const [successSnack, setSuccessSnack] = useState<string | null>(null)
  const [errorSnack, setErrorSnack] = useState<string | null>(null)

  const nameFilterOptions = useMemo(
    () => uniqueSortedStrings(users.map((user) => user.name)),
    [users],
  )
  const emailFilterOptions = useMemo(
    () => uniqueSortedStrings(users.map((user) => user.email)),
    [users],
  )
  const selectedProgramOptions = useMemo(
    () => programs.filter((program) => selectedPrograms.has(program.id)),
    [programs, selectedPrograms],
  )
  const selectedGroupOptions = useMemo(
    () => groups.filter((group) => selectedGroups.has(group.id)),
    [groups, selectedGroups],
  )
  const appliedFilters = useMemo<AppliedPeopleFilter[]>(() => {
    const chips: AppliedPeopleFilter[] = []
    const name = filters['name']?.trim()
    const email = filters['email']?.trim()
    const role = filters['role']?.trim()

    if (name) chips.push({ key: 'name', label: `Name: ${name}` })
    if (email) chips.push({ key: 'email', label: `Email: ${email}` })
    if (role) chips.push({ key: 'role', label: `Role: ${role}` })

    for (const program of selectedProgramOptions) {
      chips.push({
        key: `program:${program.id}`,
        label: `Program: ${program.name}`,
        programId: program.id,
      })
    }

    for (const group of selectedGroupOptions) {
      chips.push({
        key: `group:${group.id}`,
        label: `Group: ${group.name}`,
        groupId: group.id,
      })
    }

    return chips
  }, [filters, selectedProgramOptions, selectedGroupOptions])

  const loadData = useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    try {
      if (showLoading) {
        setLoading(true)
      }
      const usersData = await fetchUsers()
      setUsers(usersData)
    } catch (err) {
      console.error('Failed to load data', err)
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadData({ showLoading: true }) // eslint-disable-line react-hooks/set-state-in-effect -- standard data-fetch trigger on dependency change
  }, [loadData])

  useEffect(() => {
    if (initialEditUserId != null && !loading && users.length > 0) {
      const target = users.find((u) => u.id === initialEditUserId)
      if (target) {
        setEditingUser(target) // eslint-disable-line react-hooks/set-state-in-effect -- conditional on async data availability
        setAddEditOpen(true)
      } else {
        console.warn(`User ${initialEditUserId} not found in loaded users`)
      }
      onEditUserHandled?.()
    }
  }, [initialEditUserId, loading, users, onEditUserHandled])

  useEffect(() => {
    const validIds = new Set(programs.map((p) => p.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selections aligned with available programs
    setSelectedPrograms((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)))
      return pruned.size === prev.size ? prev : pruned
    })
  }, [programs])

  useEffect(() => {
    const validIds = new Set(groups.map((g) => g.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selections aligned with available groups
    setSelectedGroups((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)))
      return pruned.size === prev.size ? prev : pruned
    })
  }, [groups])

  // Sort handler
  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Filter/sort/paginate logic
  const filteredUsers = useMemo(() => {
    const activeFilters =
      Object.values(filters).some((v) => v !== '') ||
      selectedPrograms.size > 0 ||
      selectedGroups.size > 0
    if (!activeFilters) return users
    return users.filter((user) => {
      const match = (field: string, value: string) => {
        const filter = filters[field]
        if (!filter) return true
        return value.toLowerCase().includes(filter.toLowerCase())
      }
      if (!match('name', user.name)) return false
      if (!match('email', user.email)) return false
      const roleFilter = filters['role']
      if (roleFilter && user.role !== roleFilter) return false
      if (selectedPrograms.size > 0) {
        const userProgramSet = new Set(user.program_ids)
        if (![...selectedPrograms].some((id) => userProgramSet.has(id))) return false
      }
      if (selectedGroups.size > 0) {
        const userGroupSet = new Set(user.group_ids)
        if (![...selectedGroups].some((id) => userGroupSet.has(id))) return false
      }
      return true
    })
  }, [users, filters, selectedPrograms, selectedGroups])

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'email':
          cmp = a.email.localeCompare(b.email)
          break
        case 'role':
          cmp = a.role.localeCompare(b.role)
          break
        case 'program':
          cmp = a.program_names.join(', ').localeCompare(b.program_names.join(', '))
          break
        case 'group':
          cmp = a.group_names.join(', ').localeCompare(b.group_names.join(', '))
          break
        case 'last_access':
          cmp = (a.last_access ?? '').localeCompare(b.last_access ?? '')
          break
        case 'created_at':
          cmp = a.created_at.localeCompare(b.created_at)
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredUsers, sortColumn, sortDirection])

  // Auto-correct currentPage when dataset shrinks
  const maxPage = Math.max(0, Math.ceil(sortedUsers.length / rowsPerPage) - 1)
  if (currentPage > maxPage) {
    setCurrentPage(maxPage)
  }

  const handleFilterChange = (column: string, value: string) => {
    setFilters((prev) => ({ ...prev, [column]: value }))
    setCurrentPage(0)
  }

  const handleClearFilters = () => {
    setFilters({})
    setSelectedPrograms(new Set())
    setSelectedGroups(new Set())
    setCurrentPage(0)
  }

  const handleAppliedFilterDelete = (filter: AppliedPeopleFilter) => {
    if (filter.key === 'name' || filter.key === 'email' || filter.key === 'role') {
      handleFilterChange(filter.key, '')
      return
    }

    if ('programId' in filter) {
      setSelectedPrograms((prev) => {
        const next = new Set(prev)
        next.delete(filter.programId)
        return next
      })
      setCurrentPage(0)
      return
    }

    if ('groupId' in filter) {
      setSelectedGroups((prev) => {
        const next = new Set(prev)
        next.delete(filter.groupId)
        return next
      })
      setCurrentPage(0)
    }
  }

  const handleColumnVisibilityToggle = useCallback(
    (column: PeopleTableColumn) => {
      const nextVisible = !visibleColumns[column]
      setColumnVisible(column, nextVisible)
      if (!nextVisible) {
        setCurrentPage(0)
        if (column === 'program') {
          setSelectedPrograms(new Set())
        } else if (column === 'group') {
          setSelectedGroups(new Set())
        } else {
          const filterKey = PEOPLE_COLUMN_FILTER_KEYS[column]
          if (filterKey) {
            setFilters((prev) => {
              if (!prev[filterKey]) return prev
              const next = { ...prev }
              delete next[filterKey]
              return next
            })
          }
        }
      }
    },
    [setColumnVisible, visibleColumns],
  )

  const pageUsers = useMemo(
    () => sortedUsers.slice(currentPage * rowsPerPage, currentPage * rowsPerPage + rowsPerPage),
    [sortedUsers, currentPage, rowsPerPage],
  )

  const selectedInView = useMemo(
    () => pageUsers.filter((u) => selected.has(u.id)).length,
    [pageUsers, selected],
  )

  // Selection handlers — scoped to current page
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected((prev) => {
        const next = new Set(prev)
        pageUsers.forEach((u) => next.add(u.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        pageUsers.forEach((u) => next.delete(u.id))
        return next
      })
    }
  }

  const handleSelectOne = (userId: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(userId)
      } else {
        next.delete(userId)
      }
      return next
    })
  }

  // Add/Edit person handlers
  const handleOpenAdd = () => {
    setEditingUser(null)
    setAddEditOpen(true)
  }

  const handleRowClick = (user: ApiUser) => {
    setEditingUser(user)
    setAddEditOpen(true)
  }

  const handleSavePerson = async (data: {
    name: string
    email: string
    role: Role
    password?: string
    program_ids?: number[]
  }) => {
    if (editingUser) {
      await updateUser(editingUser.id, data)
    } else {
      if (!data.password) return
      await createUser({
        name: data.name,
        email: data.email,
        role: data.role,
        password: data.password,
        program_ids: data.program_ids,
      })
    }
    setAddEditOpen(false)
    setEditingUser(null)
    setSuccessSnack(editingUser ? 'Person updated.' : 'Person added.')
    await loadData()
  }

  // Bulk edit program handler
  const handleBulkSave = async (programIds: number[]) => {
    try {
      await bulkUpdateUserProgram({
        user_ids: Array.from(selected),
        program_ids: programIds,
      })
      setBulkEditOpen(false)
      setSelected(new Set())
      await loadData()
    } catch (err) {
      console.error('Failed to bulk update', err)
    }
  }

  // Bulk add-to-group handler
  const handleBulkGroupSave = async (groupIds: number[]) => {
    try {
      const results = await Promise.allSettled(
        groupIds.map((groupId) => addGroupMembersBulk(groupId, Array.from(selected))),
      )
      await loadData()

      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )

      if (failures.length > 0) {
        const failure = failures[0]?.reason
        const failureMessage = userMessage(
          failure,
          'Failed to add selected people to groups. Please try again.',
        )
        const groupWord = failures.length === 1 ? 'group' : 'groups'
        const selectionWord = selected.size === 1 ? 'person' : 'people'
        setErrorSnack(
          `Failed to add ${selectionWord} to ${failures.length} of ${groupIds.length} ${groupWord}. ${failureMessage}`,
        )
        throw failure
      }

      setBulkGroupOpen(false)
      setSelected(new Set())
      setErrorSnack(null)
      setSuccessSnack('Added to group(s).')
    } catch (err) {
      console.error('Failed to bulk add to groups', err)
      throw err
    }
  }

  // Bulk role update handler
  const handleBulkRoleSave = async () => {
    try {
      await bulkUpdateUserRole({
        user_ids: Array.from(selected),
        role: bulkRole,
      })
      setBulkRoleOpen(false)
      setBulkRole('student')
      setSelected(new Set())
      await loadData()
    } catch (err) {
      console.error('Failed to bulk update role', err)
    }
  }

  // Bulk delete handler
  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    setBulkDeleteError(null)
    try {
      await bulkDeleteUsers({
        user_ids: Array.from(selected),
      })
      setBulkDeleteOpen(false)
      setSelected(new Set())
      await loadData()
    } catch (err) {
      console.error('Failed to bulk delete', err)
      setBulkDeleteError(userMessage(err, 'Failed to delete. Please try again.'))
    } finally {
      setBulkDeleting(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 3,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h5">People</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          {selected.size > 0 && (
            <>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={() => setBulkEditOpen(true)}
              >
                Bulk Programs ({selected.size})
              </Button>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={() => setBulkGroupOpen(true)}
              >
                Bulk Groups ({selected.size})
              </Button>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={() => setBulkRoleOpen(true)}
              >
                Bulk Role ({selected.size})
              </Button>
              <Button
                variant="contained"
                color="error"
                size="small"
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete ({selected.size})
              </Button>
            </>
          )}
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={handleOpenAdd}>
            Add Person
          </Button>
        </Box>
      </Box>

      <FilterBar
        summary={
          hasActiveFilters ? (
            <>
              {appliedFilters.map((filter) => (
                <Chip
                  key={filter.key}
                  label={filter.label}
                  size="small"
                  variant="outlined"
                  onDelete={() => handleAppliedFilterDelete(filter)}
                />
              ))}
              <Button
                size="small"
                startIcon={<ClearIcon fontSize="small" />}
                onClick={handleClearFilters}
              >
                Clear filters
              </Button>
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              size="small"
              startIcon={<ViewColumnIcon fontSize="small" />}
              aria-label="Choose columns"
              onClick={() => setColumnDialogOpen(true)}
            >
              Choose columns
            </Button>
          </>
        }
      >
        {isColumnVisible('name') && (
          <Autocomplete
            freeSolo
            size="small"
            options={nameFilterOptions}
            value={filters['name'] ?? ''}
            inputValue={filters['name'] ?? ''}
            onChange={(_, value) => handleFilterChange('name', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('name', value)}
            sx={{ width: 180 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Name"
                inputProps={{ ...params.inputProps, 'aria-label': 'Name' }}
              />
            )}
          />
        )}
        {isColumnVisible('email') && (
          <Autocomplete
            freeSolo
            size="small"
            options={emailFilterOptions}
            value={filters['email'] ?? ''}
            inputValue={filters['email'] ?? ''}
            onChange={(_, value) => handleFilterChange('email', value ?? '')}
            onInputChange={(_, value) => handleFilterChange('email', value)}
            sx={{ width: 220 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Email"
                inputProps={{ ...params.inputProps, 'aria-label': 'Email' }}
              />
            )}
          />
        )}
        {isColumnVisible('role') && (
          <Autocomplete
            size="small"
            options={ROLES}
            value={(filters['role'] as Role | undefined) ?? null}
            onChange={(_, value) => handleFilterChange('role', value ?? '')}
            sx={{ width: 170 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Role"
                inputProps={{ ...params.inputProps, 'aria-label': 'Role' }}
              />
            )}
          />
        )}
        {isColumnVisible('program') && programs.length > 0 && (
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            options={programs}
            value={selectedProgramOptions}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            getOptionLabel={(option) => option.name}
            onChange={(_, values) => {
              setSelectedPrograms(new Set(values.map((program) => program.id)))
              setCurrentPage(0)
            }}
            sx={{ width: 220 }}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                {option.name}
              </li>
            )}
            renderTags={() => []}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Program"
                inputProps={{ ...params.inputProps, 'aria-label': 'Program' }}
              />
            )}
          />
        )}
        {isColumnVisible('group') && groups.length > 0 && (
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            options={groups}
            value={selectedGroupOptions}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            getOptionLabel={(option) => option.name}
            onChange={(_, values) => {
              setSelectedGroups(new Set(values.map((group) => group.id)))
              setCurrentPage(0)
            }}
            sx={{ width: 220 }}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                {option.name}
              </li>
            )}
            renderTags={() => []}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Groups"
                inputProps={{ ...params.inputProps, 'aria-label': 'Groups' }}
              />
            )}
          />
        )}
        {!isColumnVisible('name') &&
          !isColumnVisible('email') &&
          !isColumnVisible('role') &&
          !isColumnVisible('program') &&
          !isColumnVisible('group') && (
            <Typography variant="body2" color="text.secondary">
              Choose a visible filterable column to add controls here.
            </Typography>
          )}
      </FilterBar>

      {users.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          No people found.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedInView > 0 && selectedInView < pageUsers.length}
                    checked={pageUsers.length > 0 && selectedInView === pageUsers.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </TableCell>
                {isColumnVisible('id') && (
                  <TableCell sortDirection={sortColumn === 'id' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'id'}
                      direction={sortColumn === 'id' ? sortDirection : 'asc'}
                      onClick={() => handleSort('id')}
                    >
                      ID
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('name') && (
                  <TableCell sortDirection={sortColumn === 'name' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'name'}
                      direction={sortColumn === 'name' ? sortDirection : 'asc'}
                      onClick={() => handleSort('name')}
                    >
                      Name
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('email') && (
                  <TableCell sortDirection={sortColumn === 'email' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'email'}
                      direction={sortColumn === 'email' ? sortDirection : 'asc'}
                      onClick={() => handleSort('email')}
                    >
                      Email
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('role') && (
                  <TableCell sortDirection={sortColumn === 'role' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'role'}
                      direction={sortColumn === 'role' ? sortDirection : 'asc'}
                      onClick={() => handleSort('role')}
                    >
                      Role
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('program') && (
                  <TableCell sortDirection={sortColumn === 'program' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'program'}
                      direction={sortColumn === 'program' ? sortDirection : 'asc'}
                      onClick={() => handleSort('program')}
                    >
                      Program
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('group') && (
                  <TableCell sortDirection={sortColumn === 'group' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'group'}
                      direction={sortColumn === 'group' ? sortDirection : 'asc'}
                      onClick={() => handleSort('group')}
                    >
                      Groups
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('last_access') && (
                  <TableCell sortDirection={sortColumn === 'last_access' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'last_access'}
                      direction={sortColumn === 'last_access' ? sortDirection : 'asc'}
                      onClick={() => handleSort('last_access')}
                    >
                      Last Accessed
                    </TableSortLabel>
                  </TableCell>
                )}
                {isColumnVisible('created_at') && (
                  <TableCell sortDirection={sortColumn === 'created_at' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortColumn === 'created_at'}
                      direction={sortColumn === 'created_at' ? sortDirection : 'asc'}
                      onClick={() => handleSort('created_at')}
                    >
                      Created
                    </TableSortLabel>
                  </TableCell>
                )}
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageUsers.map((user) => (
                <TableRow
                  key={user.id}
                  hover
                  selected={selected.has(user.id)}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(user)}
                >
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(user.id)}
                      onChange={(e) => handleSelectOne(user.id, e.target.checked)}
                    />
                  </TableCell>
                  {isColumnVisible('id') && <TableCell>{user.id}</TableCell>}
                  {isColumnVisible('name') && <TableCell>{user.name}</TableCell>}
                  {isColumnVisible('email') && <TableCell>{user.email}</TableCell>}
                  {isColumnVisible('role') && <TableCell>{user.role}</TableCell>}
                  {isColumnVisible('program') && (
                    <TableCell>
                      {user.program_names.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {user.program_names.map((name) => (
                            <Chip key={name} label={name} size="small" color="primary" />
                          ))}
                        </Box>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {isColumnVisible('group') && (
                    <TableCell>
                      {user.group_names.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {user.group_names.map((name) => (
                            <Chip key={name} label={name} size="small" color="secondary" />
                          ))}
                        </Box>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {isColumnVisible('last_access') && (
                    <TableCell>
                      {user.last_access ? new Date(user.last_access).toLocaleDateString() : '—'}
                    </TableCell>
                  )}
                  {isColumnVisible('created_at') && (
                    <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                  )}
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        setDeleteConfirmUser(user)
                        setDeleteConfirmOpen(true)
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            rowsPerPageOptions={[5, 10, 25, 50]}
            component="div"
            count={sortedUsers.length}
            rowsPerPage={rowsPerPage}
            page={currentPage}
            onPageChange={(_, newPage) => setCurrentPage(newPage)}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setCurrentPage(0)
            }}
          />
        </TableContainer>
      )}

      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose people table columns"
        columns={PEOPLE_COLUMN_OPTIONS}
        visibleColumns={visibleColumns}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={handleColumnVisibilityToggle}
      />

      {/* Modals */}
      <AddEditPersonModal
        open={addEditOpen}
        onClose={() => {
          setAddEditOpen(false)
          setEditingUser(null)
        }}
        onSave={handleSavePerson}
        programs={programs}
        user={editingUser}
      />

      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkSave}
        programs={programs}
        selectedCount={selected.size}
      />

      <BulkGroupModal
        open={bulkGroupOpen}
        onClose={() => setBulkGroupOpen(false)}
        onSave={handleBulkGroupSave}
        groups={groups}
        selectedCount={selected.size}
      />

      {/* Bulk Role Update Dialog */}
      <Dialog open={bulkRoleOpen} onClose={() => setBulkRoleOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Bulk Update Role</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Change the role of {selected.size} selected {selected.size === 1 ? 'person' : 'people'}.
          </Typography>
          <FormControl fullWidth>
            <Select
              value={bulkRole}
              onChange={(e: SelectChangeEvent) => setBulkRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkRoleOpen(false)}>Cancel</Button>
          <Button onClick={handleBulkRoleSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => {
          if (!bulkDeleting) {
            setBulkDeleteOpen(false)
            setBulkDeleteError(null)
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Users</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {bulkDeleteError && (
            <Alert severity="error" onClose={() => setBulkDeleteError(null)}>
              {bulkDeleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            You are about to delete <strong>{selected.size}</strong>{' '}
            {selected.size === 1 ? 'user' : 'users'}.
          </Typography>
          <Divider />
          <Box>
            <Button
              color="error"
              variant="contained"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              startIcon={bulkDeleting ? <CircularProgress size={16} color="inherit" /> : undefined}
              fullWidth
            >
              Delete {selected.size} {selected.size === 1 ? 'User' : 'Users'}
            </Button>
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setBulkDeleteOpen(false)
              setBulkDeleteError(null)
            }}
            disabled={bulkDeleting}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Individual Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteConfirmOpen(false)
            setDeleteError(null)
          }
        }}
        TransitionProps={{
          onExited: () => {
            setDeleteConfirmUser(null)
            setDeleteError(null)
          },
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Person</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {deleteError && (
            <Alert severity="error" onClose={() => setDeleteError(null)}>
              {deleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Are you sure you want to delete{' '}
            <strong>{deleteConfirmUser?.name || deleteConfirmUser?.email}</strong>?
          </Typography>
          <Divider />
          <Box>
            <Button
              color="error"
              variant="contained"
              onClick={async () => {
                if (deleteConfirmUser) {
                  setDeleting(true)
                  setDeleteError(null)
                  try {
                    await deleteUser(deleteConfirmUser.id)
                    setSelected((prev) => {
                      const next = new Set(prev)
                      next.delete(deleteConfirmUser.id)
                      return next
                    })
                    await loadData()
                    setDeleteConfirmOpen(false)
                  } catch (err) {
                    console.error('Failed to delete person', err)
                    setDeleteError(userMessage(err, 'Failed to delete. Please try again.'))
                  } finally {
                    setDeleting(false)
                  }
                }
              }}
              disabled={deleting}
              startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
              fullWidth
            >
              Delete
            </Button>
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteConfirmOpen(false)
              setDeleteError(null)
            }}
            disabled={deleting}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success snackbar */}
      <Snackbar
        open={successSnack !== null}
        autoHideDuration={4000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setSuccessSnack(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessSnack(null)} variant="filled">
          {successSnack}
        </Alert>
      </Snackbar>

      <Snackbar
        open={errorSnack !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setErrorSnack(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorSnack(null)} variant="filled">
          {errorSnack}
        </Alert>
      </Snackbar>
    </Box>
  )
}
