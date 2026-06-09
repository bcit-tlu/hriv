import { useEffect, useState, useCallback, useMemo } from 'react'
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
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import ClearIcon from '@mui/icons-material/Clear'
import FilterListIcon from '@mui/icons-material/FilterList'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  bulkUpdateUserProgram,
  bulkUpdateUserRole,
  bulkDeleteUsers,
} from '../api'
import type { ApiUser } from '../api'
import type { Role, Program } from '../types'
import AddEditPersonModal from './AddEditPersonModal'
import BulkEditModal from './BulkEditModal'

type SortableColumn = 'id' | 'name' | 'email' | 'role' | 'program' | 'last_access' | 'created_at'
type SortDirection = 'asc' | 'desc'

const ROLES: Role[] = ['admin', 'instructor', 'student']

interface PeoplePageProps {
  programs: Program[]
  initialEditUserId?: number | null
  onEditUserHandled?: () => void
}

export default function PeoplePage({ programs, initialEditUserId, onEditUserHandled }: PeoplePageProps) {
  const [users, setUsers] = useState<ApiUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Sort state
  const [sortColumn, setSortColumn] = useState<SortableColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({})
  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  // Filter row visibility
  const [showFilters, setShowFilters] = useState(false)

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
    loadData()
  }, [loadData])

  useEffect(() => {
    if (initialEditUserId != null && !loading && users.length > 0) {
      const target = users.find((u) => u.id === initialEditUserId)
      if (target) {
        setEditingUser(target)
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
      if (!match('program', user.program_names.join(', '))) return false
      const roleFilter = filters['role']
      if (roleFilter && user.role !== roleFilter) return false
      return true
    })
  }, [users, filters, hasActiveFilters])

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
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedUsers.length / rowsPerPage) - 1)
    if (currentPage > maxPage) {
      setCurrentPage(maxPage)
    }
  }, [sortedUsers.length, rowsPerPage, currentPage])

  const handleFilterChange = (column: string, value: string) => {
    setFilters((prev) => ({ ...prev, [column]: value }))
    setCurrentPage(0)
  }

  const handleClearFilters = () => {
    setFilters({})
    setCurrentPage(0)
  }

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
      setSelected((prev) => { const next = new Set(prev); pageUsers.forEach((u) => next.add(u.id)); return next })
    } else {
      setSelected((prev) => { const next = new Set(prev); pageUsers.forEach((u) => next.delete(u.id)); return next })
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
    try {
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
      await loadData()
    } catch (err) {
      console.error('Failed to save person', err)
    }
  }

  const handleDeletePerson = async (userId: number) => {
    try {
      await deleteUser(userId)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
      await loadData()
    } catch (err) {
      console.error('Failed to delete person', err)
    }
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
    try {
      await bulkDeleteUsers({
        user_ids: Array.from(selected),
      })
      setBulkDeleteOpen(false)
      setSelected(new Set())
      await loadData()
    } catch (err) {
      console.error('Failed to bulk delete', err)
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">
          People
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          <Tooltip title={showFilters ? 'Hide filters' : 'Show filters'}>
            <IconButton
              size="small"
              onClick={() => setShowFilters((prev) => !prev)}
              color={showFilters || hasActiveFilters ? 'primary' : 'default'}
            >
              <FilterListIcon />
            </IconButton>
          </Tooltip>
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
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={handleOpenAdd}
          >
            Add Person
          </Button>
        </Box>
      </Box>

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
                <TableCell sortDirection={sortColumn === 'id' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'id'}
                    direction={sortColumn === 'id' ? sortDirection : 'asc'}
                    onClick={() => handleSort('id')}
                  >
                    ID
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'name' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'name'}
                    direction={sortColumn === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'email' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'email'}
                    direction={sortColumn === 'email' ? sortDirection : 'asc'}
                    onClick={() => handleSort('email')}
                  >
                    Email
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'role' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'role'}
                    direction={sortColumn === 'role' ? sortDirection : 'asc'}
                    onClick={() => handleSort('role')}
                  >
                    Role
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'program' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'program'}
                    direction={sortColumn === 'program' ? sortDirection : 'asc'}
                    onClick={() => handleSort('program')}
                  >
                    Program
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'last_access' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'last_access'}
                    direction={sortColumn === 'last_access' ? sortDirection : 'asc'}
                    onClick={() => handleSort('last_access')}
                  >
                    Last Accessed
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortColumn === 'created_at' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'created_at'}
                    direction={sortColumn === 'created_at' ? sortDirection : 'asc'}
                    onClick={() => handleSort('created_at')}
                  >
                    Created
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
              {showFilters && (
              <TableRow>
                <TableCell padding="checkbox">
                  {hasActiveFilters && (
                    <IconButton size="small" onClick={handleClearFilters} title="Clear all filters">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
                <TableCell />
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['name'] ?? ''}
                    onChange={(e) => handleFilterChange('name', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['name'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('name', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['email'] ?? ''}
                    onChange={(e) => handleFilterChange('email', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['email'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('email', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell>
                  <FormControl size="small" variant="standard" fullWidth>
                    <Select
                      value={filters['role'] ?? ''}
                      onChange={(e: SelectChangeEvent) => handleFilterChange('role', e.target.value)}
                      displayEmpty
                      sx={{ fontSize: '0.8rem' }}
                    >
                      <MenuItem value=""><em>All</em></MenuItem>
                      {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    variant="standard"
                    placeholder="Filter"
                    value={filters['program'] ?? ''}
                    onChange={(e) => handleFilterChange('program', e.target.value)}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                    InputProps={filters['program'] ? { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => handleFilterChange('program', '')}><ClearIcon sx={{ fontSize: 14 }} /></IconButton></InputAdornment> } : undefined}
                  />
                </TableCell>
                <TableCell />
                <TableCell />
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
                  <TableCell
                    padding="checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(user.id)}
                      onChange={(e) =>
                        handleSelectOne(user.id, e.target.checked)
                      }
                    />
                  </TableCell>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>
                    {user.program_names.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {user.program_names.map((name) => (
                          <Chip key={name} label={name} size="small" color="primary" />
                        ))}
                      </Box>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {user.last_access
                      ? new Date(user.last_access).toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell
                    align="right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="small"
                      color="error"
                      onClick={() => { setDeleteConfirmUser(user); setDeleteConfirmOpen(true) }}
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
            Change the role of {selected.size} selected{' '}
            {selected.size === 1 ? 'person' : 'people'}.
          </Typography>
          <FormControl fullWidth>
            <Select
              value={bulkRole}
              onChange={(e: SelectChangeEvent) => setBulkRole(e.target.value)}
            >
              {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
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
      <Dialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Users</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
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
          <Button onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Individual Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        TransitionProps={{ onExited: () => setDeleteConfirmUser(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Person</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Are you sure you want to delete <strong>{deleteConfirmUser?.name ?? deleteConfirmUser?.email}</strong>?
          </Typography>
          <Divider />
          <Box>
            <Button
              color="error"
              variant="contained"
              onClick={async () => {
                if (deleteConfirmUser) {
                  await handleDeletePerson(deleteConfirmUser.id)
                  setDeleteConfirmOpen(false)
                }
              }}
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
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
