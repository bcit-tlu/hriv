import { useState, useMemo, useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { Category } from '../types'
import { MAX_DEPTH } from '../types'
import AddCategoryDialog from './AddCategoryDialog'
import EditCategoryDialog from './EditCategoryDialog'

interface FlatOption {
  id: number
  label: string
  depth: number
  childCount: number
  status: string | null
}

function countDescendants(node: Category): number {
  let count = node.children.length
  for (const child of node.children) {
    count += countDescendants(child)
  }
  return count
}

function flattenTree(nodes: Category[], depth: number = 0): FlatOption[] {
  const result: FlatOption[] = []
  for (const node of nodes) {
    result.push({ id: node.id, label: node.label, depth, childCount: countDescendants(node), status: node.status ?? 'active' })
    result.push(...flattenTree(node.children, depth + 1))
  }
  return result
}

interface ManageCategoriesDialogProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  onAddCategory: (label: string, parentId: number | null) => Promise<void>
  onDeleteCategory: (categoryId: number) => Promise<void>
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
}

export default function ManageCategoriesDialog({
  open,
  onClose,
  categories,
  onAddCategory,
  onDeleteCategory,
  onEditCategory,
  onToggleVisibility,
}: ManageCategoriesDialogProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentDepth, setAddParentDepth] = useState(0)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FlatOption | null>(null)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<FlatOption | null>(null)

  const options = useMemo(() => flattenTree(categories), [categories])

  const handleAddClick = (parentId: number | null, depth: number) => {
    setAddParentId(parentId)
    setAddParentDepth(depth)
    setAddDialogOpen(true)
  }

  const handleAddCategory = async (label: string) => {
    await onAddCategory(label, addParentId)
  }

  const handleDeleteClick = useCallback((opt: FlatOption) => {
    setPendingDelete(opt)
    setConfirmDeleteOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (pendingDelete) {
      await onDeleteCategory(pendingDelete.id)
    }
    setConfirmDeleteOpen(false)
    setPendingDelete(null)
  }, [pendingDelete, onDeleteCategory])

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteOpen(false)
    setPendingDelete(null)
  }, [])

  const handleEditClick = useCallback((opt: FlatOption) => {
    setEditingCategory(opt)
    setEditDialogOpen(true)
  }, [])

  const handleEditSave = useCallback(async (newLabel: string) => {
    if (editingCategory && onEditCategory) {
      await onEditCategory(editingCategory.id, newLabel)
    }
  }, [editingCategory, onEditCategory])

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Add/Edit Categories</DialogTitle>
        <DialogContent>
          <List dense disablePadding>
            {/* Root-level add button */}
            <ListItem
              sx={{ pl: 2 }}
              secondaryAction={
                <Tooltip title="Add root category">
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => handleAddClick(null, 0)}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText
                primary={<em>Root level</em>}
                primaryTypographyProps={{ color: 'text.secondary' }}
              />
            </ListItem>

            {options.map((opt) => (
              <ListItem
                key={opt.id}
                sx={{ pl: 2 + opt.depth * 3 }}
                secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {onToggleVisibility && (
                        <Tooltip title={opt.status === 'hidden' ? 'Show to students' : 'Hide from students'}>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => onToggleVisibility(opt.id, opt.status !== 'hidden')}
                          >
                            {opt.status === 'hidden' ? (
                              <DisabledVisibleIcon fontSize="small" color="disabled" />
                            ) : (
                              <VisibilityIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                      {onEditCategory && (
                        <Tooltip title="Rename category">
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleEditClick(opt)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {opt.depth + 1 < MAX_DEPTH && (
                        <Tooltip title="Add child category">
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleAddClick(opt.id, opt.depth + 1)}
                          >
                            <AddIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete category">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => handleDeleteClick(opt)}
                      >
                        <DeleteIcon fontSize="small" color="primary" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemText
                  primary={
                    <>
                      {opt.depth > 0 && (
                        <Typography component="span" color="text.secondary">
                          {'\u2514 '}
                        </Typography>
                      )}
                      <Typography component="span" sx={{ opacity: opt.status === 'hidden' ? 0.5 : 1 }}>
                        {opt.label}
                      </Typography>
                    </>
                  }
                />
              </ListItem>
            ))}

            {options.length === 0 && (
              <ListItem>
                <ListItemText
                  primary="No categories yet."
                  primaryTypographyProps={{ color: 'text.secondary', fontStyle: 'italic' }}
                />
              </ListItem>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <AddCategoryDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={handleAddCategory}
        currentDepth={addParentDepth}
      />

      <EditCategoryDialog
        open={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false)
          setEditingCategory(null)
        }}
        onSave={handleEditSave}
        currentLabel={editingCategory?.label ?? ''}
      />

      {/* Confirm delete dialog */}
      <Dialog open={confirmDeleteOpen} onClose={handleCancelDelete}>
        <DialogTitle>Delete Category</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{pendingDelete?.label}</strong>?
          </DialogContentText>
          <DialogContentText sx={{ mt: 1 }}>
            All images in this category will become uncategorized (they will not be deleted).
          </DialogContentText>
          {(pendingDelete?.childCount ?? 0) > 0 && (
            <DialogContentText sx={{ mt: 1 }} color="error">
              This category has {pendingDelete?.childCount} sub-categor{pendingDelete?.childCount === 1 ? 'y' : 'ies'} that will also be permanently deleted.
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
