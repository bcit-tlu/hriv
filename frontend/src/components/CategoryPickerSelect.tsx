import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import EditIcon from '@mui/icons-material/Edit'
import LockIcon from '@mui/icons-material/Lock'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Category, Program } from '../types'
import { MAX_DEPTH } from '../types'
import AddCategoryDialog from './AddCategoryDialog'
import EditCategoryDialog from './EditCategoryDialog'

interface FlatOption {
  id: number
  label: string
  depth: number
  status: string | null
  parentId: number | null
  imageCount: number
  programIds: number[]
  inheritedRestriction: boolean
}

function flattenTree(
  nodes: Category[],
  depth: number = 0,
  excludeIds?: Set<number>,
  parentId: number | null = null,
  ancestorRestricted: boolean = false,
): FlatOption[] {
  const result: FlatOption[] = []
  for (const node of nodes) {
    if (excludeIds?.has(node.id)) continue
    const hasOwnRestriction = node.programIds.length > 0
    result.push({ id: node.id, label: node.label, depth, status: node.status ?? 'active', parentId, imageCount: node.images.length, programIds: node.programIds, inheritedRestriction: !hasOwnRestriction && ancestorRestricted })
    result.push(...flattenTree(node.children, depth + 1, excludeIds, node.id, ancestorRestricted || hasOwnRestriction))
  }
  return result
}

function collectDescendantIds(node: Category): Set<number> {
  const ids = new Set<number>([node.id])
  for (const child of node.children) {
    for (const id of collectDescendantIds(child)) {
      ids.add(id)
    }
  }
  return ids
}

function findCategoryById(nodes: Category[], id: number): Category | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findCategoryById(node.children, id)
    if (found) return found
  }
  return null
}

interface CategoryPickerSelectProps {
  categories: Category[]
  value: number | null
  onChange: (categoryId: number | null) => void
  label?: string
  excludeCategoryId?: number
  includeRoot?: boolean
  /** When provided, a "+" button appears on each menu item to add a child category. */
  onAddCategory?: (label: string, parentId: number | null, programIds?: number[]) => Promise<number | void>
  /** When provided, a delete button appears on each menu item to delete that category. */
  onDeleteCategory?: (categoryId: number) => Promise<void>
  /** When provided, a pencil button appears on each menu item to rename that category. */
  onEditCategory?: (categoryId: number, newLabel: string, programIds?: number[]) => Promise<void>
  /** When provided, a visibility toggle appears on each menu item. */
  onToggleVisibility?: (categoryId: number) => Promise<void>
  /** Available programs for the add/edit category dialogs. */
  programs?: Program[]
}

export default function CategoryPickerSelect({
  categories,
  value,
  onChange,
  label = 'Category',
  excludeCategoryId,
  includeRoot = true,
  onAddCategory,
  onDeleteCategory,
  onEditCategory,
  onToggleVisibility,
  programs,
}: CategoryPickerSelectProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentLabel, setAddParentLabel] = useState<string | undefined>(undefined)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingOpt, setEditingOpt] = useState<FlatOption | null>(null)

  const options = useMemo(() => {
    let excludeIds: Set<number> | undefined
    if (excludeCategoryId != null) {
      const cat = findCategoryById(categories, excludeCategoryId)
      if (cat) {
        excludeIds = collectDescendantIds(cat)
      }
    }
    return flattenTree(categories, 0, excludeIds)
  }, [categories, excludeCategoryId])

  const addSiblingNames = useMemo(
    () => options.filter((o) => o.parentId === addParentId).map((o) => o.label),
    [options, addParentId],
  )

  const editSiblingNames = useMemo(
    () =>
      editingOpt
        ? options
            .filter((o) => o.parentId === editingOpt.parentId && o.id !== editingOpt.id)
            .map((o) => o.label)
        : [],
    [options, editingOpt],
  )

  // Narrowing semantics: collect ancestors bottom-up, then walk top-down
  // so each ancestor with own programIds narrows (intersects) the effective set.
  const inheritedProgramIds = useMemo(() => {
    if (!editingOpt) return []
    const ancestors: FlatOption[] = []
    let curParentId: number | null = editingOpt.parentId
    while (curParentId != null) {
      const ancestor: FlatOption | undefined = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      ancestors.push(ancestor)
      curParentId = ancestor.parentId
    }
    ancestors.reverse()
    let effective: number[] = []
    for (const anc of ancestors) {
      if (anc.programIds.length > 0) {
        effective = effective.length > 0
          ? anc.programIds.filter((pid) => effective.includes(pid))
          : [...anc.programIds]
      }
    }
    return effective
  }, [editingOpt, options])

  const handleChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value
    onChange(val === '' ? null : Number(val))
  }

  const handleAddClick = (
    e: React.MouseEvent,
    parentId: number | null,
    parentLabel?: string,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    setAddParentId(parentId)
    setAddParentLabel(parentLabel)
    setAddDialogOpen(true)
  }

  const handleAddCategory = async (categoryLabel: string, programIds?: number[]) => {
    if (onAddCategory) {
      const newId = await onAddCategory(categoryLabel, addParentId, programIds)
      if (typeof newId === 'number') {
        onChange(newId)
      }
    }
  }

  const handleEditClick = (
    e: React.MouseEvent,
    opt: FlatOption,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    setEditingOpt(opt)
    setEditDialogOpen(true)
  }

  const handleEditSave = async (newLabel: string, programIds?: number[]) => {
    if (editingOpt && onEditCategory) {
      await onEditCategory(editingOpt.id, newLabel, programIds)
    }
  }

  return (
    <>
      <FormControl fullWidth variant="outlined">
        <InputLabel>{label}</InputLabel>
        <Select
          value={value == null ? '' : String(value)}
          onChange={handleChange}
          label={label}
        >
          {includeRoot && (
            <MenuItem value="">
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  <em>None (root level)</em>
                </ListItemText>
                {onAddCategory && (
                  <Tooltip title="Add child category">
                    <IconButton
                      size="small"
                      onClick={(e) => handleAddClick(e, null)}
                      sx={{ ml: 1, p: 0.5 }}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </MenuItem>
          )}
          {options.map((opt) => (
            <MenuItem key={opt.id} value={String(opt.id)} sx={{ pl: 2 + opt.depth * 3 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {opt.depth > 0 ? '\u2514 ' : ''}<span style={{ opacity: opt.status === 'hidden' ? 0.5 : 1 }}>{opt.label}</span>
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                    ({opt.imageCount})
                  </Typography>
                  {(opt.programIds.length > 0 || opt.inheritedRestriction) && (
                    <Tooltip title={opt.programIds.length > 0 ? 'Restricted to specific programs' : 'Restricted (inherited from parent)'}>
                      <LockIcon sx={{ fontSize: 14, color: 'primary.main', opacity: opt.inheritedRestriction ? 0.5 : 1, ml: 0.5, verticalAlign: 'middle' }} />
                    </Tooltip>
                  )}
                </ListItemText>
                {onToggleVisibility && (
                  <Tooltip title={opt.status === 'hidden' ? 'Show to students' : 'Hide from students'}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onToggleVisibility(opt.id)
                      }}
                      sx={{ p: 0.5 }}
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
                  <Tooltip title="Edit category">
                    <IconButton
                      size="small"
                      onClick={(e) => handleEditClick(e, opt)}
                      sx={{ p: 0.5 }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {onAddCategory && opt.depth + 1 < MAX_DEPTH && (
                  <Tooltip title="Add child category">
                    <IconButton
                      size="small"
                      onClick={(e) => handleAddClick(e, opt.id, opt.label)}
                      sx={{ ml: 1, p: 0.5 }}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {onDeleteCategory && (
                  <Tooltip title="Delete category">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onDeleteCategory(opt.id)
                      }}
                      sx={{ p: 0.5 }}
                    >
                      <DeleteIcon fontSize="small" color="primary" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {onAddCategory && (
        <AddCategoryDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onAdd={handleAddCategory}
          parentLabel={addParentLabel}
          siblingNames={addSiblingNames}
          programs={programs}
        />
      )}

      {onEditCategory && (
        <EditCategoryDialog
          open={editDialogOpen}
          onClose={() => {
            setEditDialogOpen(false)
            setEditingOpt(null)
          }}
          onSave={handleEditSave}
          currentLabel={editingOpt?.label ?? ''}
          siblingNames={editSiblingNames}
          programs={programs}
          currentProgramIds={editingOpt?.programIds ?? []}
          inheritedProgramIds={inheritedProgramIds}
        />
      )}
    </>
  )
}
