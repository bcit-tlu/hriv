import { useState } from 'react'
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
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Role, Program } from '../types'
import type { ApiUser } from '../api'

interface PersonFormData {
  name: string
  email: string
  role: Role
  password?: string
  program_id?: number | null
}

interface AddEditPersonModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: PersonFormData) => void
  programs: Program[]
  /** If provided, we are editing; otherwise adding. */
  user?: ApiUser | null
}

function AddEditPersonForm({
  onClose,
  onSave,
  programs,
  user,
}: Omit<AddEditPersonModalProps, 'open'>) {
  const isEdit = Boolean(user)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>((user?.role as Role) ?? 'student')
  const [programId, setProgramId] = useState<number | ''>(
    user?.program_id ?? '',
  )

  const handleSave = () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()
    if (!trimmedName || !trimmedEmail) return
    if (!isEdit && !trimmedPassword) return

    const data: PersonFormData = {
      name: trimmedName,
      email: trimmedEmail,
      role,
      program_id: programId === '' ? null : programId,
    }
    if (trimmedPassword) {
      data.password = trimmedPassword
    }
    onSave(data)
  }

  const handleRoleChange = (e: SelectChangeEvent) => {
    setRole(e.target.value as Role)
  }

  const handleProgramChange = (e: SelectChangeEvent<number | ''>) => {
    setProgramId(e.target.value as number | '')
  }

  const canSave = isEdit
    ? name.trim() !== '' && email.trim() !== ''
    : name.trim() !== '' && email.trim() !== '' && password.trim() !== ''

  return (
    <>
      <DialogTitle>{isEdit ? 'Edit Person' : 'Add Person'}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
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
          <InputLabel>Program</InputLabel>
          <Select
            value={programId}
            label="Program"
            onChange={handleProgramChange}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {programs.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={!canSave}>
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
  // Use key to reset form state when the modal opens or the user changes
  const formKey = user ? `edit-${user.id}` : 'add'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <AddEditPersonForm
        key={open ? formKey : 'closed'}
        onClose={onClose}
        onSave={onSave}
        programs={programs}
        user={user}
      />
    </Dialog>
  )
}
