import type { Category } from '../types'

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

function countDescendants(node: Category): number {
  let count = node.children.length
  for (const child of node.children) {
    count += countDescendants(child)
  }
  return count
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
      imageCount: node.images.length,
      childCount: countDescendants(node),
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
