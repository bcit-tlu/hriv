import { useState, useMemo } from 'react'
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DisabledVisibleIcon from '@mui/icons-material/DisabledVisible'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Category } from '../types'
import { MAX_DEPTH } from '../types'
import AddCategoryDialog from './AddCategoryDialog'
import EditCategoryDialog from './EditCategoryDialog'

interface FlatOption {
  id: number
  label: string
  depth: number
  status: string | null
}

function flattenTree(
  nodes: Category[],
  depth: number = 0,
  excludeIds?: Set<number>,
): FlatOption[] {
  const result: FlatOption[] = []
  for (const node of nodes) {
    if (excludeIds?.has(node.id)) continue
    result.push({ id: node.id, label: node.label, depth, status: node.status ?? 'active' })
    result.push(...flattenTree(node.children, depth + 1, excludeIds))
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
  onAddCategory?: (label: string, parentId: number | null) => Promise<number | void>
  /** When provided, a delete button appears on each menu item to delete that category. */
  onDeleteCategory?: (categoryId: number) => Promise<void>
  /** When provided, a pencil button appears on each menu item to rename that category. */
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  /** When provided, a visibility toggle appears on each menu item. */
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
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
}: CategoryPickerSelectProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentDepth, setAddParentDepth] = useState(0)

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

  const handleChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value
    onChange(val === '' ? null : Number(val))
  }

  const handleAddClick = (
    e: React.MouseEvent,
    parentId: number | null,
    depth: number,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    setAddParentId(parentId)
    setAddParentDepth(depth)
    setAddDialogOpen(true)
  }

  const handleAddCategory = async (categoryLabel: string) => {
    if (onAddCategory) {
      const newId = await onAddCategory(categoryLabel, addParentId)
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

  const handleEditSave = async (newLabel: string) => {
    if (editingOpt && onEditCategory) {
      await onEditCategory(editingOpt.id, newLabel)
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
                      onClick={(e) => handleAddClick(e, null, 0)}
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
                </ListItemText>
                {onToggleVisibility && (
                  <Tooltip title={opt.status === 'hidden' ? 'Show to students' : 'Hide from students'}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onToggleVisibility(opt.id, opt.status !== 'hidden')
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
                  <Tooltip title="Rename category">
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
                      onClick={(e) => handleAddClick(e, opt.id, opt.depth + 1)}
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
          currentDepth={addParentDepth}
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
        />
      )}
    </>
  )
}
