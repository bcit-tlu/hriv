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
import type { Program } from '../types'

interface ProgramManagementModalProps {
  open: boolean
  onClose: () => void
  programs: Program[]
  onAdd: (name: string, oidcGroup: string | null) => void
  onEdit: (id: number, name: string, oidcGroup: string | null) => void
  onDelete: (id: number) => void
}

export default function ProgramManagementModal({
  open,
  onClose,
  programs,
  onAdd,
  onEdit,
  onDelete,
}: ProgramManagementModalProps) {
  const [newName, setNewName] = useState('')
  const [newOidcGroup, setNewOidcGroup] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingOidcGroup, setEditingOidcGroup] = useState('')

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (trimmed) {
      onAdd(trimmed, newOidcGroup.trim() || null)
      setNewName('')
      setNewOidcGroup('')
    }
  }

  const startEdit = (program: Program) => {
    setEditingId(program.id)
    setEditingName(program.name)
    setEditingOidcGroup(program.oidc_group ?? '')
  }

  const handleEditSave = () => {
    const trimmed = editingName.trim()
    if (editingId !== null && trimmed) {
      onEdit(editingId, trimmed, editingOidcGroup.trim() || null)
      setEditingId(null)
      setEditingName('')
      setEditingOidcGroup('')
    }
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditingName('')
    setEditingOidcGroup('')
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manage Programs</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            label="New program name"
            size="small"
            fullWidth
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
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

        {programs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No programs yet.
          </Typography>
        ) : (
          <List dense>
            {programs.map((p) => (
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
                    <TextField
                      size="small"
                      label="OIDC group"
                      value={editingOidcGroup}
                      onChange={(e) => setEditingOidcGroup(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditSave()
                        if (e.key === 'Escape') handleEditCancel()
                      }}
                    />
                  </Box>
                ) : (
                  <ListItemText
                    primary={
                      <Chip label={p.name} size="small" color="primary" />
                    }
                    secondary={p.oidc_group ? `OIDC group: ${p.oidc_group}` : undefined}
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
