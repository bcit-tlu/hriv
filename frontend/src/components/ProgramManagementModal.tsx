import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import GroupIcon from '@mui/icons-material/Group'
import SettingsIcon from '@mui/icons-material/Settings'
import type { Program } from '../types'

interface ProgramManagementModalProps {
  open: boolean
  onClose: () => void
  programs: Program[]
  /** Whether the viewer is an admin (controls OIDC field + tenant creation). */
  isAdmin: boolean
  /** Program ids the current user belongs to (used to scope instructor tenants). */
  myProgramIds: number[]
  onAdd: (name: string, oidcGroup: string | null, parentProgramId: number | null) => void
  onEdit: (
    id: number,
    name: string,
    oidcGroup: string | null | undefined,
  ) => void
  onDelete: (id: number) => void
  /** Open the student-assignment dialog for a cohort. */
  onManageMembers: (cohort: Program) => void
}

export default function ProgramManagementModal({
  open,
  onClose,
  programs,
  isAdmin,
  myProgramIds,
  onAdd,
  onEdit,
  onDelete,
  onManageMembers,
}: ProgramManagementModalProps) {
  const [newName, setNewName] = useState('')
  const [newOidcGroup, setNewOidcGroup] = useState('')
  const [newParentId, setNewParentId] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingOidcGroup, setEditingOidcGroup] = useState('')
  const [editingShowOidc, setEditingShowOidc] = useState(false)

  const tenants = useMemo(
    () => programs.filter((p) => p.parent_program_id === null),
    [programs],
  )

  // Tenants the current user may create cohorts under. Admins may use any
  // tenant; instructors are limited to tenants they belong to.
  const selectableTenants = useMemo(
    () => (isAdmin ? tenants : tenants.filter((t) => myProgramIds.includes(t.id))),
    [isAdmin, tenants, myProgramIds],
  )

  const selectableTenantIds = useMemo(
    () => new Set(selectableTenants.map((t) => t.id)),
    [selectableTenants],
  )

  // Programs shown in the list. Admins see everything; instructors only see
  // the cohorts under tenants they manage.
  const visiblePrograms = useMemo(() => {
    if (isAdmin) return programs
    return programs.filter(
      (p) =>
        p.parent_program_id !== null && selectableTenantIds.has(p.parent_program_id),
    )
  }, [isAdmin, programs, selectableTenantIds])

  const tenantName = (id: number | null): string | undefined =>
    id === null ? undefined : tenants.find((t) => t.id === id)?.name

  // Instructors must pick a parent tenant (cohorts only). Admins may leave it
  // empty to create a top-level tenant program.
  const addDisabled = !newName.trim() || (!isAdmin && newParentId === '')

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed || addDisabled) return
    const parentId = newParentId === '' ? null : newParentId
    // A cohort never carries an OIDC group; only admins setting a top-level
    // program may provide one.
    const oidc = isAdmin && parentId === null ? newOidcGroup.trim() || null : null
    onAdd(trimmed, oidc, parentId)
    setNewName('')
    setNewOidcGroup('')
    setNewParentId('')
    setShowAdvanced(false)
  }

  const startEdit = (program: Program) => {
    setEditingId(program.id)
    setEditingName(program.name)
    setEditingOidcGroup(program.oidc_group ?? '')
    setEditingShowOidc(false)
  }

  const handleEditSave = () => {
    const trimmed = editingName.trim()
    if (editingId !== null && trimmed) {
      const program = programs.find((p) => p.id === editingId)
      // OIDC is only editable by admins on tenant (top-level) programs.
      // Everyone else (instructors, or admins editing a cohort) must omit the
      // field entirely so the backend's rename-only guard isn't tripped.
      const oidc =
        isAdmin && program?.parent_program_id === null
          ? editingOidcGroup.trim() || null
          : undefined
      onEdit(editingId, trimmed, oidc)
      setEditingId(null)
      setEditingName('')
      setEditingOidcGroup('')
      setEditingShowOidc(false)
    }
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditingName('')
    setEditingOidcGroup('')
    setEditingShowOidc(false)
  }

  const addLabel = isAdmin ? 'New program name' : 'New cohort name'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isAdmin ? 'Manage Programs' : 'Manage Cohorts'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2, mt: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              label={addLabel}
              size="small"
              fullWidth
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
            <TextField
              select
              label={isAdmin ? 'Parent program' : 'Program'}
              size="small"
              sx={{ minWidth: 200 }}
              value={newParentId === '' ? '' : String(newParentId)}
              onChange={(e) =>
                setNewParentId(e.target.value === '' ? '' : Number(e.target.value))
              }
              helperText={
                isAdmin
                  ? 'Leave empty for a top-level program'
                  : 'The program this cohort belongs to'
              }
            >
              {isAdmin && (
                <MenuItem value="">
                  <em>None (top-level program)</em>
                </MenuItem>
              )}
              {selectableTenants.map((t) => (
                <MenuItem key={t.id} value={String(t.id)}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={handleAdd}
              disabled={addDisabled}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Add
            </Button>
          </Box>

          {/* Issue #559: OIDC/IdP fields are admin-only and tucked behind an
              "Advanced" disclosure so they are never front-and-centre. They
              only apply to top-level (tenant) programs. */}
          {isAdmin && newParentId === '' && (
            <Box>
              <Button
                size="small"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
              >
                {showAdvanced ? 'Hide advanced' : 'Advanced'}
              </Button>
              <Collapse in={showAdvanced} unmountOnExit>
                <TextField
                  label="OIDC group (optional)"
                  size="small"
                  fullWidth
                  value={newOidcGroup}
                  onChange={(e) => setNewOidcGroup(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd()
                  }}
                  helperText="IdP group name for auto-assignment"
                  sx={{ mt: 1 }}
                />
              </Collapse>
            </Box>
          )}
        </Box>

        {visiblePrograms.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {isAdmin ? 'No programs yet.' : 'No cohorts yet.'}
          </Typography>
        ) : (
          <List
            dense
            subheader={
              !isAdmin ? <ListSubheader disableSticky>Cohorts</ListSubheader> : undefined
            }
          >
            {visiblePrograms.map((p) => (
              <ListItem
                key={p.id}
                secondaryAction={
                  editingId === p.id ? (
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Button size="small" onClick={handleEditCancel}>
                        Cancel
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleEditSave}
                        disabled={!editingName.trim()}
                      >
                        Save
                      </Button>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {p.is_cohort && (
                        <IconButton
                          size="small"
                          onClick={() => onManageMembers(p)}
                          aria-label={`manage students in ${p.name}`}
                        >
                          <GroupIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => startEdit(p)}
                        aria-label="edit program"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => onDelete(p.id)}
                        aria-label="delete program"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )
                }
              >
                {editingId === p.id ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mr: 2 }}>
                    <TextField
                      size="small"
                      label="Name"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditSave()
                        if (e.key === 'Escape') handleEditCancel()
                      }}
                      autoFocus
                    />
                    {/* OIDC editing is admin-only and only for tenant programs;
                        revealed behind a gear icon (issue #559). */}
                    {isAdmin && p.parent_program_id === null && (
                      <Box>
                        <Button
                          size="small"
                          startIcon={<SettingsIcon fontSize="small" />}
                          onClick={() => setEditingShowOidc((v) => !v)}
                          aria-expanded={editingShowOidc}
                          aria-label="OIDC settings"
                        >
                          {editingShowOidc ? 'Hide advanced' : 'Advanced'}
                        </Button>
                        <Collapse in={editingShowOidc} unmountOnExit>
                          <TextField
                            size="small"
                            label="OIDC group"
                            fullWidth
                            value={editingOidcGroup}
                            onChange={(e) => setEditingOidcGroup(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEditSave()
                              if (e.key === 'Escape') handleEditCancel()
                            }}
                            sx={{ mt: 1 }}
                          />
                        </Collapse>
                      </Box>
                    )}
                  </Box>
                ) : (
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={p.name}
                          size="small"
                          color={p.is_cohort ? 'default' : 'primary'}
                        />
                        {p.is_cohort && (
                          <Typography variant="caption" color="text.secondary">
                            cohort of {tenantName(p.parent_program_id) ?? '—'}
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      isAdmin && p.oidc_group ? `OIDC group: ${p.oidc_group}` : undefined
                    }
                  />
                )}
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
