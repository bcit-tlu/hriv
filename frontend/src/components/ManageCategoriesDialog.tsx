import { useState, useMemo, useCallback, useRef } from 'react'
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
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
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
  parentId: number | null
}

function countDescendants(node: Category): number {
  let count = node.children.length
  for (const child of node.children) {
    count += countDescendants(child)
  }
  return count
}

function flattenTree(nodes: Category[], depth: number = 0, parentId: number | null = null): FlatOption[] {
  const result: FlatOption[] = []
  for (const node of nodes) {
    result.push({ id: node.id, label: node.label, depth, childCount: countDescendants(node), status: node.status ?? 'active', parentId })
    result.push(...flattenTree(node.children, depth + 1, node.id))
  }
  return result
}

/** Collect all descendant IDs of a given category from the flat list. */
function getDescendantIds(options: FlatOption[], dragId: number): Set<number> {
  const ids = new Set<number>()
  const idx = options.findIndex((o) => o.id === dragId)
  if (idx < 0) return ids
  const baseDepth = options[idx].depth
  for (let i = idx + 1; i < options.length; i++) {
    if (options[i].depth <= baseDepth) break
    ids.add(options[i].id)
  }
  return ids
}

interface DropTarget {
  index: number
  depth: number
  parentId: number | null
}

/**
 * Compute the drop target from cursor position relative to the list.
 */
function computeDropTarget(
  options: FlatOption[],
  dragId: number,
  listElement: HTMLElement,
  clientY: number,
  clientX: number,
): DropTarget | null {
  const descendantIds = getDescendantIds(options, dragId)
  const visibleOptions = options.filter((o) => o.id !== dragId && !descendantIds.has(o.id))
  const listItems = Array.from(listElement.querySelectorAll<HTMLElement>('[data-category-id]'))
  const visibleElements = listItems.filter((el) => {
    const elId = Number(el.dataset.categoryId)
    return elId !== dragId && !descendantIds.has(elId)
  })

  let insertAfterVisIdx = -1
  for (let i = 0; i < visibleElements.length; i++) {
    const rect = visibleElements[i].getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (clientY > midY) {
      insertAfterVisIdx = i
    } else {
      break
    }
  }

  let targetIndex: number
  if (insertAfterVisIdx < 0) {
    targetIndex = 0
  } else if (insertAfterVisIdx >= visibleOptions.length) {
    targetIndex = options.length
  } else {
    const afterOption = visibleOptions[insertAfterVisIdx]
    const origIdx = options.findIndex((o) => o.id === afterOption.id)
    targetIndex = origIdx + 1
  }

  const listRect = listElement.getBoundingClientRect()
  const relX = clientX - listRect.left
  const rawDepth = Math.max(0, Math.round(relX / 24))

  let minDepth = 0
  let maxDepth = 0

  if (insertAfterVisIdx < 0) {
    minDepth = 0
    maxDepth = 0
  } else {
    const above = visibleOptions[insertAfterVisIdx]
    if (above) {
      maxDepth = Math.min(above.depth + 1, MAX_DEPTH - 1)
    }
    const belowVisIdx = insertAfterVisIdx + 1
    if (belowVisIdx < visibleOptions.length) {
      minDepth = Math.min(visibleOptions[belowVisIdx].depth, maxDepth)
    }
  }

  const depth = Math.max(minDepth, Math.min(rawDepth, maxDepth))

  let parentId: number | null = null
  if (depth > 0 && insertAfterVisIdx >= 0) {
    for (let i = insertAfterVisIdx; i >= 0; i--) {
      if (visibleOptions[i].depth === depth - 1) {
        parentId = visibleOptions[i].id
        break
      }
      if (visibleOptions[i].depth < depth - 1) break
    }
  }

  return { index: targetIndex, depth, parentId }
}

interface ManageCategoriesDialogProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  onAddCategory: (label: string, parentId: number | null) => Promise<number | void>
  onDeleteCategory: (categoryId: number) => Promise<void>
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
  onReorderCategories?: (items: Array<{ id: number; parent_id: number | null; sort_order: number }>) => Promise<void>
}

export default function ManageCategoriesDialog({
  open,
  onClose,
  categories,
  onAddCategory,
  onDeleteCategory,
  onEditCategory,
  onToggleVisibility,
  onReorderCategories,
}: ManageCategoriesDialogProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentDepth, setAddParentDepth] = useState(0)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FlatOption | null>(null)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<FlatOption | null>(null)

  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

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

  // ── Drag-and-drop handlers ──────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, id: number) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDropTarget(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId == null || !listRef.current) return
    const target = computeDropTarget(options, dragId, listRef.current, e.clientY, e.clientX)
    setDropTarget(target)
  }, [dragId, options])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    if (dragId == null || dropTarget == null || !onReorderCategories) {
      setDragId(null)
      setDropTarget(null)
      return
    }

    const descendantIds = getDescendantIds(options, dragId)
    const draggedIdx = options.findIndex((o) => o.id === dragId)
    if (draggedIdx < 0) { setDragId(null); setDropTarget(null); return }

    const draggedItems: FlatOption[] = [options[draggedIdx]]
    for (let i = draggedIdx + 1; i < options.length; i++) {
      if (options[i].depth <= options[draggedIdx].depth) break
      draggedItems.push(options[i])
    }

    const remaining = options.filter((o) => o.id !== dragId && !descendantIds.has(o.id))

    const depthDelta = dropTarget.depth - draggedItems[0].depth
    const adjustedDragged = draggedItems.map((item, idx) => ({
      ...item,
      depth: item.depth + depthDelta,
      parentId: idx === 0 ? dropTarget.parentId : item.parentId,
    }))

    let insertIdx = remaining.length
    for (let i = 0; i < remaining.length; i++) {
      const origIdx = options.findIndex((o) => o.id === remaining[i].id)
      if (origIdx >= dropTarget.index) {
        insertIdx = i
        break
      }
    }

    const newList = [
      ...remaining.slice(0, insertIdx),
      ...adjustedDragged,
      ...remaining.slice(insertIdx),
    ]

    const reorderItems: Array<{ id: number; parent_id: number | null; sort_order: number }> = []
    const sortCounters = new Map<string, number>()

    for (const item of newList) {
      const key = String(item.parentId)
      const counter = sortCounters.get(key) ?? 0
      reorderItems.push({
        id: item.id,
        parent_id: item.parentId,
        sort_order: counter,
      })
      sortCounters.set(key, counter + 1)
    }

    setDragId(null)
    setDropTarget(null)

    await onReorderCategories(reorderItems)
  }, [dragId, dropTarget, options, onReorderCategories])

  // Compute the Y position and indentation for the drop indicator line
  const dropIndicatorStyle = useMemo(() => {
    if (dropTarget == null || dragId == null || !listRef.current) return null
    const descendantIds = getDescendantIds(options, dragId)
    const listItems = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-category-id]'))

    const visibleElements = listItems.filter((el) => {
      const elId = Number(el.dataset.categoryId)
      return elId !== dragId && !descendantIds.has(elId)
    })

    const visibleOptions = options.filter((o) => o.id !== dragId && !descendantIds.has(o.id))

    let visibleInsertIdx = visibleOptions.length
    for (let i = 0; i < visibleOptions.length; i++) {
      const origIdx = options.findIndex((o) => o.id === visibleOptions[i].id)
      if (origIdx >= dropTarget.index) {
        visibleInsertIdx = i
        break
      }
    }

    const listRect = listRef.current.getBoundingClientRect()
    let topPos: number

    if (visibleInsertIdx === 0 && visibleElements.length > 0) {
      const firstRect = visibleElements[0].getBoundingClientRect()
      topPos = firstRect.top - listRect.top - 1
    } else if (visibleInsertIdx >= visibleElements.length) {
      if (visibleElements.length > 0) {
        const lastRect = visibleElements[visibleElements.length - 1].getBoundingClientRect()
        topPos = lastRect.bottom - listRect.top - 1
      } else {
        topPos = 0
      }
    } else {
      const itemRect = visibleElements[visibleInsertIdx].getBoundingClientRect()
      topPos = itemRect.top - listRect.top - 1
    }

    return {
      top: topPos,
      left: 16 + dropTarget.depth * 24,
    }
  }, [dropTarget, dragId, options])

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Categories</DialogTitle>
        <DialogContent>
          <List
            dense
            disablePadding
            ref={listRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            sx={{ position: 'relative' }}
          >
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
                data-category-id={opt.id}
                draggable={!!onReorderCategories}
                onDragStart={(e) => handleDragStart(e, opt.id)}
                onDragEnd={handleDragEnd}
                sx={{
                  pl: 2 + opt.depth * 3,
                  opacity: dragId === opt.id ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
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
                {onReorderCategories && (
                  <DragIndicatorIcon
                    fontSize="small"
                    sx={{ color: 'text.secondary', mr: 0.5, flexShrink: 0, cursor: 'grab' }}
                  />
                )}
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

            {/* Drop indicator line */}
            {dropIndicatorStyle && dragId != null && (
              <Box
                sx={{
                  position: 'absolute',
                  top: dropIndicatorStyle.top,
                  left: dropIndicatorStyle.left,
                  right: 16,
                  height: 2,
                  bgcolor: 'primary.main',
                  borderRadius: 1,
                  pointerEvents: 'none',
                  zIndex: 10,
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: -4,
                    top: -3,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                  },
                }}
              />
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
