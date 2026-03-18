import { useMemo } from 'react'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Category } from '../types'

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
}

export default function CategoryPickerSelect({
  categories,
  value,
  onChange,
  label = 'Category',
  excludeCategoryId,
  includeRoot = true,
}: CategoryPickerSelectProps) {
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

  return (
    <FormControl fullWidth variant="outlined">
      <InputLabel>{label}</InputLabel>
      <Select
        value={value == null ? '' : String(value)}
        onChange={handleChange}
        label={label}
      >
        {includeRoot && (
          <MenuItem value="">
            <em>None (root level)</em>
          </MenuItem>
        )}
        {options.map((opt) => (
          <MenuItem key={opt.id} value={String(opt.id)}>
            {'  '.repeat(opt.depth)}{opt.depth > 0 ? '└ ' : ''}{opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
