import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SchoolIcon from '@mui/icons-material/School'
import PersonIcon from '@mui/icons-material/Person'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { User, Role } from '../types'

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <AdminPanelSettingsIcon fontSize="small" />,
  instructor: <SchoolIcon fontSize="small" />,
  student: <PersonIcon fontSize="small" />,
}

const ROLE_COLORS: Record<string, 'error' | 'warning' | 'info'> = {
  admin: 'error',
  instructor: 'warning',
  student: 'info',
}

interface UserManagementPanelProps {
  open: boolean
  onClose: () => void
  users: User[]
  currentUserId: string
  onAddUser: (name: string, email: string, role: Role) => void
  onDeleteUser: (userId: string) => void
}

export default function UserManagementPanel({
  open,
  onClose,
  users,
  currentUserId,
  onAddUser,
  onDeleteUser,
}: UserManagementPanelProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('student')

  const handleAdd = () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (trimmedName && trimmedEmail) {
      onAddUser(trimmedName, trimmedEmail, role)
      setName('')
      setEmail('')
      setRole('student')
      setAddOpen(false)
    }
  }

  const handleRoleChange = (e: SelectChangeEvent) => {
    setRole(e.target.value as Role)
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>User Management</DialogTitle>
        <DialogContent>
          <List>
            {users.map((user, index) => (
              <Box key={user.id}>
                {index > 0 && <Divider />}
                <ListItem
                  secondaryAction={
                    user.id !== currentUserId ? (
                      <IconButton
                        edge="end"
                        aria-label="delete"
                        color="error"
                        onClick={() => onDeleteUser(user.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    ) : null
                  }
                >
                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        {user.name}
                        <Chip
                          icon={ROLE_ICONS[user.role] as React.ReactElement}
                          label={user.role}
                          size="small"
                          color={ROLE_COLORS[user.role]}
                          variant="outlined"
                        />
                        {user.id === currentUserId && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            (you)
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={user.email}
                  />
                </ListItem>
              </Box>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<PersonAddIcon />}
            onClick={() => setAddOpen(true)}
          >
            Add User
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add user dialog */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Add User</DialogTitle>
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
          />
          <TextField
            label="Email"
            fullWidth
            variant="outlined"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={role} label="Role" onChange={handleRoleChange}>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="instructor">Instructor</MenuItem>
              <MenuItem value="student">Student</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            onClick={handleAdd}
            variant="contained"
            disabled={!name.trim() || !email.trim()}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
