import { useEffect, useState, useCallback, useMemo } from 'react'
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
import Snackbar from '@mui/material/Snackbar'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
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
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import { alpha } from '@mui/material/styles'
import ClearIcon from '@mui/icons-material/Clear'
import FilterListIcon from '@mui/icons-material/FilterList'
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
  userMessage,
} from '../api'
import type { ApiUser } from '../api'
import type { Role, Program, Group } from '../types'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import AddEditPersonModal from './AddEditPersonModal'
import BulkEditModal from './BulkEditModal'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'

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

interface PeoplePageProps {
  programs: Program[]
  groups: Group[]
  initialEditUserId?: number | null
  onEditUserHandled?: () => void
}

export default function PeoplePage({
  programs,
  groups = [],
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

  // Filter row visibility
  const [showFilters, setShowFilters] = useState(false)
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const usersData = await fetchUsers()
      setUsers(usersData)
    } catch (err) {
      console.error('Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData() // eslint-disable-line react-hooks/set-state-in-effect -- standard data-fetch trigger on dependency change
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
    if (!hasActiveFilters) return users
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
  }, [users, filters, hasActiveFilters, selectedPrograms, selectedGroups])

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

  const handleColumnVisibilityToggle = useCallback(
    (column: PeopleTableColumn) => {
      const nextVisible = !visibleColumns[column]
      setColumnVisible(column, nextVisible)
      if (!nextVisible) {
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
          <ToggleButtonGroup
            size="small"
            aria-label="People table controls"
            sx={{
              '& .MuiToggleButton-root': (theme) => ({
                bgcolor: alpha(theme.palette.text.primary, 0.09),
                color: theme.palette.text.primary,
                borderColor: alpha(theme.palette.text.primary, 0.2),
                '&:hover': {
                  bgcolor: alpha(theme.palette.text.primary, 0.13),
                },
              }),
              '& .MuiToggleButton-root.Mui-selected': (theme) => ({
                bgcolor: alpha(theme.palette.text.primary, 0.15),
                color: theme.palette.text.primary,
                borderColor: alpha(theme.palette.text.primary, 0.26),
                '&:hover': {
                  bgcolor: alpha(theme.palette.text.primary, 0.17),
                },
              }),
            }}
          >
            <ToggleButton
              value="filters"
              selected={showFilters || hasActiveFilters}
              size="small"
              title={showFilters ? 'Hide filters' : 'Show filters'}
              aria-label={showFilters ? 'Hide filters' : 'Show filters'}
              onClick={() => setShowFilters((prev) => !prev)}
            >
              <FilterListIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton
              value="columns"
              selected={columnDialogOpen}
              size="small"
              title="Choose columns"
              aria-label="Choose columns"
              onClick={() => setColumnDialogOpen(true)}
            >
              <ViewColumnIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
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

      {showFilters && (programs.length > 0 || groups.length > 0) && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            px: 1,
            py: 1.25,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {programs.length > 0 && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.75 }}
              >
                Filter by program
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {programs.map((p) => {
                  const active = selectedPrograms.has(p.id)
                  return (
                    <Chip
                      key={p.id}
                      label={p.name}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => {
                        setSelectedPrograms((prev) => {
                          const next = new Set(prev)
                          if (next.has(p.id)) {
                            next.delete(p.id)
                          } else {
                            next.add(p.id)
                          }
                          return next
                        })
                        setCurrentPage(0)
                      }}
                    />
                  )
                })}
              </Box>
            </Box>
          )}
          {groups.length > 0 && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.75 }}
              >
                Filter by group
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {groups.map((g) => {
                  const active = selectedGroups.has(g.id)
                  return (
                    <Chip
                      key={g.id}
                      label={g.name}
                      size="small"
                      color={active ? 'secondary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => {
                        setSelectedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(g.id)) {
                            next.delete(g.id)
                          } else {
                            next.add(g.id)
                          }
                          return next
                        })
                        setCurrentPage(0)
                      }}
                    />
                  )
                })}
              </Box>
            </Box>
          )}
        </Box>
      )}

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
              {showFilters && (
                <TableRow>
                  <TableCell padding="checkbox">
                    {hasActiveFilters && (
                      <IconButton
                        size="small"
                        onClick={handleClearFilters}
                        title="Clear all filters"
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                  {isColumnVisible('id') && <TableCell />}
                  {isColumnVisible('name') && (
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        placeholder="Filter"
                        value={filters['name'] ?? ''}
                        onChange={(e) => handleFilterChange('name', e.target.value)}
                        slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                        InputProps={
                          filters['name']
                            ? {
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton
                                      size="small"
                                      onClick={() => handleFilterChange('name', '')}
                                    >
                                      <ClearIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              }
                            : undefined
                        }
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('email') && (
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        placeholder="Filter"
                        value={filters['email'] ?? ''}
                        onChange={(e) => handleFilterChange('email', e.target.value)}
                        slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                        InputProps={
                          filters['email']
                            ? {
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton
                                      size="small"
                                      onClick={() => handleFilterChange('email', '')}
                                    >
                                      <ClearIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              }
                            : undefined
                        }
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('role') && (
                    <TableCell>
                      <FormControl size="small" variant="standard" fullWidth>
                        <Select
                          value={filters['role'] ?? ''}
                          onChange={(e: SelectChangeEvent) =>
                            handleFilterChange('role', e.target.value)
                          }
                          displayEmpty
                          sx={{ fontSize: '0.8rem' }}
                        >
                          <MenuItem value="">
                            <em>All</em>
                          </MenuItem>
                          {ROLES.map((r) => (
                            <MenuItem key={r} value={r}>
                              {r}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                  )}
                  {isColumnVisible('program') && <TableCell />}
                  {isColumnVisible('group') && <TableCell />}
                  {isColumnVisible('last_access') && <TableCell />}
                  {isColumnVisible('created_at') && <TableCell />}
                  <TableCell />
                </TableRow>
              )}
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
    </Box>
  )
}
