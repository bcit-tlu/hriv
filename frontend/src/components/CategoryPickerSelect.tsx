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
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Category } from '../types'
import { MAX_DEPTH } from '../types'
import AddCategoryDialog from './AddCategoryDialog'

interface FlatOption {
  id: number
  label: string
  depth: number
}

function flattenTree(
  nodes: Category[],
  depth: number = 0,
  excludeIds?: Set<number>,
): FlatOption[] {
  const result: FlatOption[] = []
  for (const node of nodes) {
    if (excludeIds?.has(node.id)) continue
    result.push({ id: node.id, label: node.label, depth })
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
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
  /** When provided, a delete button appears on each menu item to delete that category. */
  onDeleteCategory?: (categoryId: number) => Promise<void>
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
}: CategoryPickerSelectProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentDepth, setAddParentDepth] = useState(0)

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
      await onAddCategory(categoryLabel, addParentId)
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
            <MenuItem key={opt.id} value={String(opt.id)}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {'  '.repeat(opt.depth)}{opt.depth > 0 ? '\u2514 ' : ''}{opt.label}
                </ListItemText>
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
                      <DeleteIcon fontSize="small" color="error" />
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
    </>
  )
}
