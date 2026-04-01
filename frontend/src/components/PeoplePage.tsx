import { useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import {
  fetchUsers,
  fetchPrograms,
  createUser,
  updateUser,
  deleteUser,
  createProgram,
  updateProgram,
  deleteProgram,
  bulkUpdateUserProgram,
} from '../api'
import type { ApiUser } from '../api'
import type { Role, Program } from '../types'
import AddEditPersonModal from './AddEditPersonModal'
import ProgramManagementModal from './ProgramManagementModal'
import BulkEditModal from './BulkEditModal'

export default function PeoplePage() {
  const [users, setUsers] = useState<ApiUser[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null)
  const [programModalOpen, setProgramModalOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [usersData, programsData] = await Promise.all([
        fetchUsers(),
        fetchPrograms(),
      ])
      setUsers(usersData)
      setPrograms(programsData)
    } catch (err) {
      console.error('Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(users.map((u) => u.id)))
    } else {
      setSelected(new Set())
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
    program_id?: number | null
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
          program_id: data.program_id,
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

  // Program handlers
  const handleAddProgram = async (name: string) => {
    try {
      await createProgram({ name })
      await loadData()
    } catch (err) {
      console.error('Failed to add program', err)
    }
  }

  const handleEditProgram = async (id: number, name: string) => {
    try {
      await updateProgram(id, { name })
      await loadData()
    } catch (err) {
      console.error('Failed to edit program', err)
    }
  }

  const handleDeleteProgram = async (id: number) => {
    try {
      await deleteProgram(id)
      await loadData()
    } catch (err) {
      console.error('Failed to delete program', err)
    }
  }

  // Bulk edit handler
  const handleBulkSave = async (programId: number | null) => {
    try {
      await bulkUpdateUserProgram({
        user_ids: Array.from(selected),
        program_id: programId,
      })
      setBulkEditOpen(false)
      setSelected(new Set())
      await loadData()
    } catch (err) {
      console.error('Failed to bulk update', err)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const allSelected = users.length > 0 && selected.size === users.length
  const someSelected = selected.size > 0 && selected.size < users.length

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">
          People
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          {selected.size > 0 && (
            <Button
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => setBulkEditOpen(true)}
            >
              Bulk Edit ({selected.size} selected)
            </Button>
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

      {/* User table */}
      {users.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          No people found.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: '#fff' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={someSelected}
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Program</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow
                  key={user.id}
                  hover
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
                  <TableCell>{user.program_name ?? '—'}</TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell
                    align="right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="small"
                      color="primary"
                      onClick={() => handleDeletePerson(user.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

      <ProgramManagementModal
        open={programModalOpen}
        onClose={() => setProgramModalOpen(false)}
        programs={programs}
        onAdd={handleAddProgram}
        onEdit={handleEditProgram}
        onDelete={handleDeleteProgram}
      />

      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkSave}
        programs={programs}
        selectedCount={selected.size}
      />
    </Box>
  )
}
