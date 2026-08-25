import { type Category } from '../types'

export interface FlatCategoryOption {
  id: number
  label: string
  depth: number
  status: string | null
  parentId: number | null
  imageCount: number
  childCount: number
  programIds: number[]
  groupIds: number[]
  inheritedProgramRestriction: boolean
  inheritedGroupRestriction: boolean
}

// Returns category IDs whose parent (or any higher ancestor) is hidden in the
// pre-order flattened output from flattenCategoryOptions().
// Includes IDs even if the category itself is also directly hidden.
export function getAncestorHiddenIds(options: FlatCategoryOption[]): Set<number> {
  const ids = new Set<number>()
  const hiddenAtDepth: boolean[] = []

  for (const opt of options) {
    hiddenAtDepth.length = opt.depth
    const parentHidden = opt.depth > 0 ? (hiddenAtDepth[opt.depth - 1] ?? false) : false
    if (parentHidden) ids.add(opt.id)
    hiddenAtDepth[opt.depth] = parentHidden || opt.status === 'hidden'
  }

  return ids
}

export function countDescendantSubcategories(node: Category): number {
  let count = node.children.length
  for (const child of node.children) {
    count += countDescendantSubcategories(child)
  }
  return count
}

function countDescendantImages(node: Category): number {
  let count = node.images.length
  for (const child of node.children) {
    count += countDescendantImages(child)
  }
  return count
}

export function formatCategoryItemCounts(childCount: number, imageCount: number): string {
  const parts: string[] = []
  if (childCount > 0) {
    parts.push(`${childCount} sub-${childCount === 1 ? 'category' : 'categories'}`)
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`)
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'Empty'
}

export function formatCategoryItemCountsForCategory(node: Category): string {
  return formatCategoryItemCounts(countDescendantSubcategories(node), countDescendantImages(node))
}

export function flattenCategoryOptions(
  nodes: Category[],
  depth: number = 0,
  excludeIds?: Set<number>,
  parentId: number | null = null,
  ancestorProgramRestricted: boolean = false,
  ancestorGroupRestricted: boolean = false,
): FlatCategoryOption[] {
  const result: FlatCategoryOption[] = []
  for (const node of nodes) {
    if (excludeIds?.has(node.id)) continue
    const hasOwnProgramRestriction = node.programIds.length > 0
    const hasOwnGroupRestriction = node.groupIds.length > 0
    result.push({
      id: node.id,
      label: node.label,
      depth,
      status: node.status ?? 'active',
      parentId,
      imageCount: countDescendantImages(node),
      childCount: countDescendantSubcategories(node),
      programIds: node.programIds,
      groupIds: node.groupIds,
      inheritedProgramRestriction: !hasOwnProgramRestriction && ancestorProgramRestricted,
      inheritedGroupRestriction: !hasOwnGroupRestriction && ancestorGroupRestricted,
    })
    result.push(
      ...flattenCategoryOptions(
        node.children,
        depth + 1,
        excludeIds,
        node.id,
        ancestorProgramRestricted || hasOwnProgramRestriction,
        ancestorGroupRestricted || hasOwnGroupRestriction,
      ),
    )
  }
  return result
}
