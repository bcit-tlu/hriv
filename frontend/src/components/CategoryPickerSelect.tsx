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
import EditIcon from '@mui/icons-material/Edit'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Visibility from '@mui/icons-material/Visibility'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Category, Group, Program } from '../types'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getVisibilityColors } from '../theme'
import { MAX_DEPTH } from '../types'
import { useColorMode } from '../useColorMode'
import AddCategoryDialog from './AddCategoryDialog'
import CategoryRestrictionIcons from './CategoryRestrictionIcons'
import EditCategoryDialog from './EditCategoryDialog'
import {
  flattenCategoryOptions,
  getAncestorHiddenIds,
  type FlatCategoryOption,
} from './categoryOptionUtils'

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

// Sentinel value so MUI fires onChange even when external value is already null
const ROOT_VALUE = '__root__'

interface CategoryPickerSelectProps {
  categories: Category[]
  value: number | null
  onChange: (categoryId: number | null) => void
  label?: string
  excludeCategoryId?: number
  includeRoot?: boolean
  /** Text shown in the collapsed select when value is null. Works with both includeRoot={true} (e.g. BulkEditImagesModal — placeholder shows initially, root option still available in dropdown) and includeRoot={false} (null means "no selection" only). */
  placeholder?: string
  /** When provided, a "+" button appears on each menu item to add a child category. */
  onAddCategory?: (
    label: string,
    parentId: number | null,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<number | void>
  /** When provided, a delete button appears on each menu item to delete that category. */
  onDeleteCategory?: (categoryId: number) => Promise<void>
  /** When provided, a pencil button appears on each menu item to rename that category. */
  onEditCategory?: (
    categoryId: number,
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
    status?: 'active' | 'hidden',
  ) => Promise<void>
  /** When provided, a visibility toggle appears on each menu item. */
  onToggleVisibility?: (categoryId: number) => Promise<void>
  /** Available programs for the add/edit category dialogs. */
  programs?: Program[]
  /** Available groups for the add/edit category dialogs. */
  groups?: Group[]
}

export default function CategoryPickerSelect({
  categories,
  value,
  onChange,
  label = 'Category',
  excludeCategoryId,
  includeRoot = true,
  placeholder,
  onAddCategory,
  onDeleteCategory,
  onEditCategory,
  onToggleVisibility,
  programs,
  groups,
}: CategoryPickerSelectProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<number | null>(null)
  const [addParentLabel, setAddParentLabel] = useState<string | undefined>(undefined)

  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingOptId, setEditingOptId] = useState<number | null>(null)

  const options = useMemo(() => {
    let excludeIds: Set<number> | undefined
    if (excludeCategoryId != null) {
      const cat = findCategoryById(categories, excludeCategoryId)
      if (cat) {
        excludeIds = collectDescendantIds(cat)
      }
    }
    return flattenCategoryOptions(categories, 0, excludeIds)
  }, [categories, excludeCategoryId])

  const addSiblingNames = useMemo(
    () => options.filter((o) => o.parentId === addParentId).map((o) => o.label),
    [options, addParentId],
  )

  // Derive editingOpt from ID + options so it stays fresh without an extra render
  const editingOpt = useMemo(
    () => (editingOptId != null ? (options.find((o) => o.id === editingOptId) ?? null) : null),
    [editingOptId, options],
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
    if (!editingOpt) return []
    const ancestors: FlatCategoryOption[] = []
    let curParentId: number | null = editingOpt.parentId
    while (curParentId != null) {
      const ancestor: FlatCategoryOption | undefined = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      ancestors.push(ancestor)
      curParentId = ancestor.parentId
    }
    ancestors.reverse()
    return narrowProgramIds(ancestors)
  }, [editingOpt, options])

  const currentProgramIds = useMemo(() => editingOpt?.programIds ?? [], [editingOpt?.programIds])

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
    if (!editingOpt) return []
    const ancestors: FlatCategoryOption[] = []
    let curParentId: number | null = editingOpt.parentId
    while (curParentId != null) {
      const ancestor: FlatCategoryOption | undefined = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      ancestors.push(ancestor)
      curParentId = ancestor.parentId
    }
    ancestors.reverse()
    return narrowGroupIds(ancestors)
  }, [editingOpt, options])

  const currentGroupIds = useMemo(() => editingOpt?.groupIds ?? [], [editingOpt?.groupIds])

  const editAncestorHidden = useMemo(() => {
    if (!editingOpt) return false
    let curParentId: number | null = editingOpt.parentId
    while (curParentId != null) {
      const ancestor = options.find((o) => o.id === curParentId)
      if (!ancestor) break
      if (ancestor.status === 'hidden') return true
      curParentId = ancestor.parentId
    }
    return false
  }, [editingOpt, options])

  const ancestorHiddenIds = useMemo(() => getAncestorHiddenIds(options), [options])

  const selectValue =
    value == null ? (placeholder ? '' : includeRoot ? ROOT_VALUE : '') : String(value)

  const handleChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value
    onChange(val === '' || val === ROOT_VALUE ? null : Number(val))
  }

  const handleAddClick = (e: React.MouseEvent, parentId: number | null, parentLabel?: string) => {
    e.stopPropagation()
    e.preventDefault()
    setAddParentId(parentId)
    setAddParentLabel(parentLabel)
    setAddDialogOpen(true)
  }

  const handleAddCategory = async (
    categoryLabel: string,
    programIds?: number[],
    groupIds?: number[],
  ) => {
    if (onAddCategory) {
      const newId = await onAddCategory(categoryLabel, addParentId, programIds, groupIds)
      if (typeof newId === 'number') {
        onChange(newId)
      }
    }
  }

  const handleEditClick = (e: React.MouseEvent, opt: FlatCategoryOption) => {
    e.stopPropagation()
    e.preventDefault()
    setEditingOptId(opt.id)
    setEditDialogOpen(true)
  }

  const handleEditSave = async (
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
    status?: 'active' | 'hidden',
  ) => {
    if (editingOpt && onEditCategory) {
      await onEditCategory(editingOpt.id, newLabel, programIds, groupIds, status)
    }
  }

  return (
    <>
      <FormControl fullWidth variant="outlined">
        <InputLabel shrink={value != null || includeRoot || !!placeholder || undefined}>
          {label}
        </InputLabel>
        <Select
          value={selectValue}
          onChange={handleChange}
          label={label}
          displayEmpty={includeRoot || !!placeholder}
          renderValue={(selected) => {
            if (selected === '') {
              if (placeholder) return <em>{placeholder}</em>
              return ''
            }
            if (selected === ROOT_VALUE) return <em>None (root level)</em>
            const opt = options.find((o) => String(o.id) === selected)
            return opt?.label ?? selected
          }}
        >
          {includeRoot && (
            <MenuItem value={ROOT_VALUE}>
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
                      onMouseDown={(e) => e.stopPropagation()}
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
          {options.length === 0 && (
            <MenuItem disabled>
              <ListItemText>
                <Typography variant="body2" color="text.secondary">
                  No other categories available
                </Typography>
              </ListItemText>
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
                  {opt.depth > 0 ? '\u2514 ' : ''}
                  <Box
                    component="span"
                    sx={{
                      color:
                        opt.status === 'hidden' || ancestorHiddenIds.has(opt.id)
                          ? visColors.inactive
                          : undefined,
                    }}
                  >
                    {opt.label}
                  </Box>
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
                    ({opt.imageCount})
                  </Typography>
                  <CategoryRestrictionIcons
                    hasProgramRestriction={
                      opt.programIds.length > 0 || opt.inheritedProgramRestriction
                    }
                    inheritedProgramRestriction={opt.inheritedProgramRestriction}
                    hasGroupRestriction={opt.groupIds.length > 0 || opt.inheritedGroupRestriction}
                    inheritedGroupRestriction={opt.inheritedGroupRestriction}
                    hidden={opt.status === 'hidden'}
                  />
                </ListItemText>
                {onToggleVisibility &&
                  (() => {
                    const inheritedHidden = ancestorHiddenIds.has(opt.id)
                    if (inheritedHidden) {
                      return (
                        <Tooltip title="Hidden by parent category">
                          <span role="img" aria-label="Hidden by parent category">
                            <VisibilityOff
                              fontSize="small"
                              sx={{ color: visColors.inactive, opacity: 0.5 }}
                            />
                          </span>
                        </Tooltip>
                      )
                    }
                    return (
                      <Tooltip
                        title={
                          opt.status === 'hidden'
                            ? 'Visibility: Show category'
                            : 'Visibility: Hide category'
                        }
                      >
                        <IconButton
                          size="small"
                          aria-label={
                            opt.status === 'hidden'
                              ? 'Visibility: Show category'
                              : 'Visibility: Hide category'
                          }
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            onToggleVisibility(opt.id)
                          }}
                          sx={{ p: 0.5 }}
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
                      size="small"
                      onMouseDown={(e) => e.stopPropagation()}
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
                      onMouseDown={(e) => e.stopPropagation()}
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
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onDeleteCategory(opt.id)
                      }}
                      sx={{ p: 0.5 }}
                    >
                      <DeleteIcon
                        fontSize="small"
                        sx={{
                          color:
                            opt.status === 'hidden' || ancestorHiddenIds.has(opt.id)
                              ? visColors.inactive
                              : 'primary.main',
                        }}
                      />
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
          inheritedProgramIds={addInheritedProgramIds}
          groups={groups}
          inheritedGroupIds={addInheritedGroupIds}
        />
      )}

      {onEditCategory && (
        <EditCategoryDialog
          open={editDialogOpen && editingOpt != null}
          onClose={() => {
            setEditDialogOpen(false)
            setEditingOptId(null)
          }}
          onSave={handleEditSave}
          currentLabel={editingOpt?.label ?? ''}
          siblingNames={editSiblingNames}
          programs={programs}
          currentProgramIds={currentProgramIds}
          inheritedProgramIds={inheritedProgramIds}
          groups={groups}
          currentGroupIds={currentGroupIds}
          inheritedGroupIds={inheritedGroupIds}
          categoryId={editingOpt?.id}
          categoryStatus={editingOpt?.status}
          ancestorHidden={editAncestorHidden}
        />
      )}
    </>
  )
}
