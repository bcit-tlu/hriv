import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Role, Program } from '../types'
import type { ApiUser } from '../api'
import { userMessage } from '../api'

interface PersonFormData {
  name: string
  email: string
  role: Role
  password?: string
  program_ids?: number[]
}

interface AddEditPersonModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: PersonFormData) => Promise<void>
  programs: Program[]
  /** If provided, we are editing; otherwise adding. */
  user?: ApiUser | null
}

function AddEditPersonForm({
  onClose,
  onSave,
  onSavingChange,
  programs,
  user,
}: Omit<AddEditPersonModalProps, 'open'> & { onSavingChange?: (saving: boolean) => void }) {
  const isEdit = Boolean(user)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>((user?.role as Role) ?? 'student')
  const [programIds, setProgramIds] = useState<number[]>(user?.program_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()
    if (!trimmedName || !trimmedEmail) return
    if (!isEdit && !trimmedPassword) return

    const data: PersonFormData = {
      name: trimmedName,
      email: trimmedEmail,
      role,
      program_ids: programIds,
    }
    if (trimmedPassword) {
      data.password = trimmedPassword
    }
    setSaving(true)
    onSavingChange?.(true)
    setSaveError(null)
    try {
      await onSave(data)
    } catch (err) {
      setSaveError(userMessage(err, 'Failed to save. Please try again.'))
    } finally {
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  const handleRoleChange = (e: SelectChangeEvent) => {
    setRole(e.target.value as Role)
  }

  const handleProgramChange = (e: SelectChangeEvent<number[]>) => {
    const val = e.target.value
    setProgramIds(typeof val === 'string' ? [] : val)
  }

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  const canSave =
    !saving &&
    (isEdit
      ? name.trim() !== '' && email.trim() !== ''
      : name.trim() !== '' && email.trim() !== '' && password.trim() !== '')

  // Build the full list of programs to show in the dropdown: active programs
  // plus any programs the user is currently assigned to that may have been
  // deleted (so they can be deselected). Deleted entries are visually
  // distinguished by chip colour but remain selectable so users can remove them.
  const activeProgramIds = new Set(programs.map((p) => p.id))
  const orphanedProgramIds = programIds.filter((id) => !activeProgramIds.has(id))
  const allDropdownPrograms: Array<{ id: number; name: string; deleted: boolean }> = [
    ...programs.map((p) => ({ id: p.id, name: p.name, deleted: false })),
    ...orphanedProgramIds.map((id) => ({ id, name: `Program #${id} (deleted)`, deleted: true })),
  ]

  return (
    <>
      <DialogTitle>{isEdit ? 'Edit Person' : 'Add Person'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {saveError && (
          <Alert severity="error" onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        )}
        <TextField
          autoFocus
          label="Full name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1 }}
        />
        <TextField
          label="Email"
          fullWidth
          variant="outlined"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label={isEdit ? 'Password (leave blank to keep)' : 'Password'}
          type="password"
          fullWidth
          variant="outlined"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormControl fullWidth>
          <InputLabel>Role</InputLabel>
          <Select value={role} label="Role" onChange={handleRoleChange}>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="instructor">Instructor</MenuItem>
            <MenuItem value="student">Student</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel shrink>Programs</InputLabel>
          <Select
            multiple
            value={programIds}
            label="Programs"
            onChange={handleProgramChange}
            displayEmpty
            notched
            renderValue={(selected) =>
              selected.length === 0 ? (
                <Typography color="text.secondary">All Programs</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((id) => {
                    const prog = allDropdownPrograms.find((p) => p.id === id)
                    return (
                      <Chip
                        key={id}
                        label={prog?.name ?? `Program #${id}`}
                        size="small"
                        color={prog?.deleted ? 'default' : 'primary'}
                      />
                    )
                  })}
                </Box>
              )
            }
          >
            {allDropdownPrograms.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            {role === 'student'
              ? 'Select one or more programs to restrict access'
              : 'Instructors and admins can see all content regardless of program assignment'}
          </FormHelperText>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {isEdit ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </>
  )
}

export default function AddEditPersonModal({
  open,
  onClose,
  onSave,
  programs,
  user,
}: AddEditPersonModalProps) {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset save state on reopen
    if (open) setSaving(false)
  }, [open])
  // Use key to reset form state when the modal opens or the user changes
  const formKey = user ? `edit-${user.id}` : 'add'

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      disableEscapeKeyDown={saving}
      maxWidth="xs"
      fullWidth
    >
      <AddEditPersonForm
        key={open ? formKey : 'closed'}
        onClose={onClose}
        onSave={onSave}
        onSavingChange={setSaving}
        programs={programs}
        user={user}
      />
    </Dialog>
  )
}
