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
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Visibility from '@mui/icons-material/Visibility'
import type { Category, Group, ImageItem, Program } from '../types'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getVisibilityColors } from '../theme'
import { MAX_DEPTH } from '../types'
import { useColorMode } from '../useColorMode'
import AddCategoryDialog from './AddCategoryDialog'
import CategoryRestrictionIcons from './CategoryRestrictionIcons'
import EditCategoryDialog from './EditCategoryDialog'
import { flattenCategoryOptions, type FlatCategoryOption } from './categoryOptionUtils'
import { collectImagesByParent, interleavedSortOrders } from './manageCategoriesDialogUtils'
import type { FlatOption } from './manageCategoriesDialogUtils'

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
  uncategorizedImages?: ImageItem[]
  onAddCategory: (label: string, parentId: number | null, programIds?: number[], groupIds?: number[]) => Promise<number | void>
  onDeleteCategory: (categoryId: number) => Promise<void>
  onEditCategory?: (categoryId: number, newLabel: string, programIds?: number[], groupIds?: number[], status?: string | null) => Promise<void>
  programs?: Program[]
  groups?: Group[]
  onToggleVisibility?: (categoryId: number) => Promise<void>
  onReorderCategories?: (items: Array<{ id: number; parent_id: number | null; sort_order: number }>) => Promise<void>
  onReorderImages?: (items: Array<{ id: number; sort_order: number }>) => Promise<void>
  onReorderComplete?: () => Promise<void> | void
}

export default function ManageCategoriesDialog({
  open,
  onClose,
  categories,
  uncategorizedImages = [],
  onAddCategory,
  onDeleteCategory,
  onEditCategory,
  onToggleVisibility,
  onReorderCategories,
  onReorderImages,
  onReorderComplete,
  programs = [],
  groups = [],
}: ManageCategoriesDialogProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentLabel, setAddParentLabel] = useState<string | undefined>(undefined)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FlatOption | null>(null)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null)

  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const options = useMemo(() => flattenCategoryOptions(categories) as FlatOption[], [categories])

  /** Set of category IDs whose ancestor is hidden (for cascading visibility). */
  const ancestorHiddenIds = useMemo(() => {
    const ids = new Set<number>()
    const hiddenAtDepth = new Map<number, boolean>()
    for (const opt of options) {
      const parentHidden = opt.depth > 0 && (hiddenAtDepth.get(opt.depth - 1) ?? false)
      const selfHidden = opt.status === 'hidden'
      if (parentHidden) ids.add(opt.id)
      hiddenAtDepth.set(opt.depth, parentHidden || selfHidden)
      // Clear deeper entries when we move back up
      for (const [d] of hiddenAtDepth) { if (d > opt.depth) hiddenAtDepth.delete(d) }
    }
    return ids
  }, [options])

  const addSiblingNames = useMemo(
    () => options.filter((o) => o.parentId === addParentId).map((o) => o.label),
    [options, addParentId],
  )

  // Derive editingCategory from ID + options so it stays fresh without an extra render
  const editingCategory = useMemo(
    () => editingCategoryId != null ? options.find((o) => o.id === editingCategoryId) ?? null : null,
    [editingCategoryId, options],
  )

  const editSiblingNames = useMemo(
    () =>
      editingCategory
        ? options
            .filter((o) => o.parentId === editingCategory.parentId && o.id !== editingCategory.id)
            .map((o) => o.label)
        : [],
    [options, editingCategory],
  )

  const addInheritedProgramIds = useMemo(() => {
    if (addParentId == null) return []
    const ancestors: FlatCategoryOption[] = []
    let curId: number | null = addParentId
    while (curId != null) {
      const anc: FlatCategoryOption | undefined = options.find((o) => o.id === curId)
      if (!anc) break
      ancestors.push(anc)
      curId = anc.parentId
    }
    ancestors.reverse()
    return narrowProgramIds(ancestors)
  }, [addParentId, options])

  const inheritedProgramIds = useMemo(() => {
    if (!editingCategory) return []
    const ancestors: FlatCategoryOption[] = []
    let curParentId: number | null = editingCategory.parentId
    while (curParentId != null) {
      const ancestor: FlatCategoryOption | undefined = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      ancestors.push(ancestor)
      curParentId = ancestor.parentId
    }
    ancestors.reverse()
    return narrowProgramIds(ancestors)
  }, [editingCategory, options])

  const currentProgramIds = useMemo(
    () => editingCategory?.programIds ?? [],
    [editingCategory?.programIds],
  )

  const addInheritedGroupIds = useMemo(() => {
    if (addParentId == null) return []
    const ancestors: FlatCategoryOption[] = []
    let curId: number | null = addParentId
    while (curId != null) {
      const anc: FlatCategoryOption | undefined = options.find((o) => o.id === curId)
      if (!anc) break
      ancestors.push(anc)
      curId = anc.parentId
    }
    ancestors.reverse()
    return narrowGroupIds(ancestors)
  }, [addParentId, options])

  const inheritedGroupIds = useMemo(() => {
    if (!editingCategory) return []
    const ancestors: FlatCategoryOption[] = []
    let curParentId: number | null = editingCategory.parentId
    while (curParentId != null) {
      const ancestor: FlatCategoryOption | undefined = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      ancestors.push(ancestor)
      curParentId = ancestor.parentId
    }
    ancestors.reverse()
    return narrowGroupIds(ancestors)
  }, [editingCategory, options])

  const currentGroupIds = useMemo(
    () => editingCategory?.groupIds ?? [],
    [editingCategory?.groupIds],
  )

  const editAncestorHidden = useMemo(() => {
    if (!editingCategory) return false
    let curParentId: number | null = editingCategory.parentId
    while (curParentId != null) {
      const ancestor = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      if (ancestor.status === 'hidden') return true
      curParentId = ancestor.parentId
    }
    return false
  }, [editingCategory, options])

  const handleAddClick = (parentId: number | null, parentLabel?: string) => {
    setAddParentId(parentId)
    setAddParentLabel(parentLabel)
    setAddDialogOpen(true)
  }

  const handleAddCategory = async (label: string, programIds: number[], groupIds: number[]) => {
    await onAddCategory(label, addParentId, programIds, groupIds)
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
    setEditingCategoryId(opt.id)
    setEditDialogOpen(true)
  }, [])

  const handleEditSave = useCallback(async (newLabel: string, programIds?: number[], groupIds?: number[], status?: string | null) => {
    if (editingCategory && onEditCategory) {
      await onEditCategory(editingCategory.id, newLabel, programIds, groupIds, status)
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

    const imagesByParent = collectImagesByParent(categories, uncategorizedImages)
    const { catItems, imgItems } = interleavedSortOrders(newList, options, imagesByParent)

    setDragId(null)
    setDropTarget(null)

    try {
      await onReorderCategories(catItems)
    } catch {
      await onReorderComplete?.()
      return
    }
    if (imgItems.length > 0 && onReorderImages) {
      try {
        await onReorderImages(imgItems)
      } catch { /* error already surfaced by the wrapper */ }
    }
    await onReorderComplete?.()
  }, [dragId, dropTarget, options, categories, uncategorizedImages, onReorderCategories, onReorderImages, onReorderComplete])

  // Compute the Y position and indentation for the drop indicator line
  const dropIndicatorStyle = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- DOM measurement needed for drop indicator positioning during active drag
    if (dropTarget == null || dragId == null || !listRef.current) return null
    const descendantIds = getDescendantIds(options, dragId)
    // eslint-disable-next-line react-hooks/refs -- DOM measurement needed for drop indicator positioning during active drag
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

    // eslint-disable-next-line react-hooks/refs -- DOM measurement needed for drop indicator positioning during active drag
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
                    onClick={() => handleAddClick(null)}
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

            {options.map((opt) => {
              const inheritedHidden = ancestorHiddenIds.has(opt.id)
              const effectivelyHidden = opt.status === 'hidden' || inheritedHidden
              return (
              <ListItem
                key={opt.id}
                data-category-id={opt.id}
                draggable={!!onReorderCategories}
                onDragStart={(e) => handleDragStart(e, opt.id)}
                onDragEnd={handleDragEnd}
                sx={{
                  pl: 2 + opt.depth * 3,
                  pr: 18,
                  opacity: dragId === opt.id ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
                secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {onToggleVisibility && (() => {
                        if (inheritedHidden) {
                          return (
                            <Tooltip title="Hidden by parent category">
                              <span>
                                <IconButton
                                  edge="end"
                                  size="small"
                                  disabled
                                  aria-label="Visibility: Hidden by parent category"
                                >
                                  <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        }
                        return (
                          <Tooltip title={opt.status === 'hidden' ? 'Visibility: Show to students' : 'Visibility: Hide from students'}>
                            <IconButton
                              edge="end"
                              size="small"
                              aria-label={opt.status === 'hidden' ? 'Visibility: Show to students' : 'Visibility: Hide from students'}
                              onClick={() => onToggleVisibility(opt.id)}
                            >
                              {opt.status === 'hidden' ? (
                                <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                              ) : (
                                <Visibility fontSize="small" sx={{ color: visColors.active }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        )
                      })()}
                      {onEditCategory && (
                        <Tooltip title="Edit category">
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
                            onClick={() => handleAddClick(opt.id, opt.label)}
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
                        <DeleteIcon fontSize="small" sx={{ color: effectivelyHidden ? visColors.inactive : 'primary.main' }} />
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
                      <Typography component="span" sx={{ color: effectivelyHidden ? visColors.inactive : undefined }}>
                        {opt.label}
                      </Typography>
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                        ({opt.imageCount})
                      </Typography>
                      <CategoryRestrictionIcons
                        hasProgramRestriction={opt.programIds.length > 0 || opt.inheritedProgramRestriction}
                        inheritedProgramRestriction={opt.inheritedProgramRestriction}
                        hasGroupRestriction={opt.groupIds.length > 0 || opt.inheritedGroupRestriction}
                        inheritedGroupRestriction={opt.inheritedGroupRestriction}
                        hidden={effectivelyHidden}
                        onProgramClick={onEditCategory ? () => handleEditClick(opt) : undefined}
                        onGroupClick={onEditCategory ? () => handleEditClick(opt) : undefined}
                      />
                    </>
                  }
                />
              </ListItem>
              )
            })}

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
        parentLabel={addParentLabel}
        siblingNames={addSiblingNames}
        programs={programs}
        inheritedProgramIds={addInheritedProgramIds}
        groups={groups}
        inheritedGroupIds={addInheritedGroupIds}
      />

      {onEditCategory && (
        <EditCategoryDialog
          open={editDialogOpen && editingCategory != null}
          onClose={() => {
            setEditDialogOpen(false)
            setEditingCategoryId(null)
          }}
          onSave={handleEditSave}
          currentLabel={editingCategory?.label ?? ''}
          siblingNames={editSiblingNames}
          programs={programs}
          currentProgramIds={currentProgramIds}
          inheritedProgramIds={inheritedProgramIds}
          groups={groups}
          currentGroupIds={currentGroupIds}
          inheritedGroupIds={inheritedGroupIds}
          categoryId={editingCategory?.id}
          categoryStatus={editingCategory?.status}
          ancestorHidden={editAncestorHidden}
        />
      )}

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
