import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import GroupIcon from '@mui/icons-material/Group'
import type { Group } from '../types'

interface GroupManagementModalProps {
  open: boolean
  onClose: () => void
  groups: Group[]
  onAdd: (name: string, description: string | null) => void
  onEdit: (id: number, name: string, description: string | null) => void
  onDelete: (id: number) => void
  onManageMembers: (group: Group) => void
  /**
   * Whether the current user may rename/delete/manage members of a group.
   * Admins manage all groups; instructors only the ones they co-own. The
   * backend enforces this too, but gating the UI avoids 403s on no-op clicks.
   */
  canManage: (group: Group) => boolean
}

export default function GroupManagementModal({
  open,
  onClose,
  groups,
  onAdd,
  onEdit,
  onDelete,
  onManageMembers,
  canManage,
}: GroupManagementModalProps) {
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingDescription, setEditingDescription] = useState('')

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (trimmed) {
      onAdd(trimmed, newDescription.trim() || null)
      setNewName('')
      setNewDescription('')
    }
  }

  const startEdit = (group: Group) => {
    setEditingId(group.id)
    setEditingName(group.name)
    setEditingDescription(group.description ?? '')
  }

  const handleEditSave = () => {
    const trimmed = editingName.trim()
    if (editingId !== null && trimmed) {
      onEdit(editingId, trimmed, editingDescription.trim() || null)
      setEditingId(null)
      setEditingName('')
      setEditingDescription('')
    }
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditingName('')
    setEditingDescription('')
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manage Groups</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            label="New group name"
            size="small"
            fullWidth
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
          <TextField
            label="Description (optional)"
            size="small"
            fullWidth
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={!newName.trim()}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Add
          </Button>
        </Box>

        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No groups yet.
          </Typography>
        ) : (
          <List dense>
            {groups.map((g) => {
              const manageable = canManage(g)
              return (
                <ListItem
                  key={g.id}
                  secondaryAction={
                    editingId === g.id ? (
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
                        <IconButton
                          size="small"
                          onClick={() => onManageMembers(g)}
                          disabled={!manageable}
                          aria-label={`manage members of ${g.name}`}
                        >
                          <GroupIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => startEdit(g)}
                          disabled={!manageable}
                          aria-label="edit group"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => onDelete(g.id)}
                          disabled={!manageable}
                          aria-label="delete group"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )
                  }
                >
                  {editingId === g.id ? (
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
                      <TextField
                        size="small"
                        label="Description"
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleEditSave()
                          if (e.key === 'Escape') handleEditCancel()
                        }}
                      />
                    </Box>
                  ) : (
                    <ListItemText
                      primary={<Chip label={g.name} size="small" color="secondary" />}
                      secondary={g.description ?? undefined}
                    />
                  )}
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
