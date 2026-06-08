/**
 * Shared category-tree utilities: narrowing semantics for program/group
 * restrictions, and path-based tree traversal.
 *
 * Used by App.tsx, ManageCategoriesDialog, CategoryPickerSelect, ManagePage,
 * and useBrowseData.
 */

import type { Category, ImageItem } from "./types";

/**
 * Walk an ordered (top-down) list of ancestors applying narrowing semantics:
 * the first ancestor with programIds initializes the effective set; each
 * subsequent ancestor with programIds intersects (narrows) it.
 *
 * A child can never widen the restriction beyond what its ancestors allow.
 */
export function narrowProgramIds(
  ancestors: ReadonlyArray<{ programIds: number[] }>,
): number[] {
  let effective: number[] = []
  let initialized = false
  for (const node of ancestors) {
    if (node.programIds.length > 0) {
      effective = initialized
        ? node.programIds.filter((pid) => effective.includes(pid))
        : [...node.programIds]
      initialized = true
    }
  }
  return effective
}

/**
 * Group analogue of {@link narrowProgramIds}. Groups are an independent
 * visibility dimension from programs, but inherit the same ancestor-cascade
 * (narrowing) semantics: a child can never widen its group restriction beyond
 * what its ancestors allow.
 */
export function narrowGroupIds(
  ancestors: ReadonlyArray<{ groupIds: number[] }>,
): number[] {
  let effective: number[] = []
  let initialized = false
  for (const node of ancestors) {
    if (node.groupIds.length > 0) {
      effective = initialized
        ? node.groupIds.filter((gid) => effective.includes(gid))
        : [...node.groupIds]
      initialized = true
    }
  }
  return effective
}

/**
 * Given an ordered top-down category path (ancestors followed by the leaf
 * category), compute the effective program restriction via narrowing and split
 * the result into "direct" IDs (present on the leaf category itself) and
 * "ancestor" IDs (inherited from above but not on the leaf).
 */
export function splitDirectAncestorProgramIds(
  fullPath: ReadonlyArray<{ programIds: number[] }>,
): { direct: number[]; ancestor: number[] } {
  if (fullPath.length === 0) return { direct: [], ancestor: [] }
  const ownCategory = fullPath[fullPath.length - 1]
  const effective = narrowProgramIds(fullPath)
  const directIds = new Set(ownCategory.programIds)
  const direct = effective.filter((pid) => directIds.has(pid))
  const ancestor = effective.filter((pid) => !directIds.has(pid))
  return { direct, ancestor }
}

/**
 * Walk the category tree along `path` and return the children/images
 * at the terminal node.
 */
export function resolvePathNode(
  categories: Category[],
  path: Category[],
): { cats: Category[]; imgs: ImageItem[] } {
  let node = categories
  for (const segment of path) {
    const found = node.find((c) => c.id === segment.id)
    if (!found) return { cats: [], imgs: [] }
    node = found.children
    if (segment === path[path.length - 1]) {
      return { cats: found.children, imgs: found.images }
    }
  }
  return { cats: node, imgs: [] }
}
