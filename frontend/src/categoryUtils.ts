/**
 * Shared category-tree utilities: narrowing semantics for program/group
 * restrictions, and path-based tree traversal.
 *
 * Used by App.tsx, ManageCategoriesDialog, CategoryPickerSelect, ManagePage,
 * and useBrowseData.
 */

import type { Category, ImageItem } from './types'

/**
 * Walk an ordered (top-down) list of ancestors applying narrowing semantics:
 * the first ancestor with programIds initializes the effective set; each
 * subsequent ancestor with programIds intersects (narrows) it.
 *
 * A child can never widen the restriction beyond what its ancestors allow.
 */
export function narrowProgramIds(ancestors: ReadonlyArray<{ programIds: number[] }>): number[] {
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
export function narrowGroupIds(ancestors: ReadonlyArray<{ groupIds: number[] }>): number[] {
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
export function splitDirectAncestorProgramIds(fullPath: ReadonlyArray<{ programIds: number[] }>): {
  direct: number[]
  ancestor: number[]
} {
  if (fullPath.length === 0) return { direct: [], ancestor: [] }
  const ownCategory = fullPath[fullPath.length - 1]
  const effective = narrowProgramIds(fullPath)
  const directIds = new Set(ownCategory.programIds)
  const direct = effective.filter((pid) => directIds.has(pid))
  const ancestor = effective.filter((pid) => !directIds.has(pid))
  return { direct, ancestor }
}

/**
 * Given an ordered top-down category path (ancestors followed by the leaf
 * category), compute the effective group restriction via narrowing and split
 * the result into "direct" IDs (present on the leaf category itself) and
 * "ancestor" IDs (inherited from above but not on the leaf).
 */
export function splitDirectAncestorGroupIds(fullPath: ReadonlyArray<{ groupIds: number[] }>): {
  direct: number[]
  ancestor: number[]
} {
  if (fullPath.length === 0) return { direct: [], ancestor: [] }
  const ownCategory = fullPath[fullPath.length - 1]
  const effective = narrowGroupIds(fullPath)
  const directIds = new Set(ownCategory.groupIds)
  const direct = effective.filter((gid) => directIds.has(gid))
  const ancestor = effective.filter((gid) => !directIds.has(gid))
  return { direct, ancestor }
}

/**
 * Describes the restriction change when a category is moved to a new parent.
 * Both dimensions (programs and groups) are evaluated independently.
 *
 * `hasChange` is true when either the effective program IDs or the effective
 * group IDs will differ after the move (after applying the category's own
 * direct restrictions against the new ancestor context).
 */
export interface MoveRestrictionChange {
  /** Whether any restriction dimension changes as a result of the move. */
  hasChange: boolean
  /** Effective program IDs at the old location (inherited + direct narrowing). */
  oldEffectiveProgramIds: number[]
  /** Effective program IDs at the new location (inherited + direct narrowing). */
  newEffectiveProgramIds: number[]
  /** Effective group IDs at the old location (inherited + direct narrowing). */
  oldEffectiveGroupIds: number[]
  /** Effective group IDs at the new location (inherited + direct narrowing). */
  newEffectiveGroupIds: number[]
}

/**
 * Compute how effective restrictions change when `category` is moved from its
 * current parent to the new parent described by `newAncestorPath`.
 *
 * `currentAncestorPath` is the ordered (top-down) list of ancestors *above*
 * the category being moved (i.e. not including the category itself).
 * `newAncestorPath` is the equivalent ancestor list at the destination.
 *
 * The category's own direct `programIds`/`groupIds` are retained but
 * re-intersected against the new ancestor context — matching the backend
 * narrowing semantics.
 */
export function computeMoveRestrictionChange(
  category: { programIds: number[]; groupIds: number[] },
  currentAncestorPath: ReadonlyArray<{ programIds: number[]; groupIds: number[] }>,
  newAncestorPath: ReadonlyArray<{ programIds: number[]; groupIds: number[] }>,
): MoveRestrictionChange {
  const oldEffectiveProgramIds = narrowProgramIds([...currentAncestorPath, category])
  const newEffectiveProgramIds = narrowProgramIds([...newAncestorPath, category])
  const oldEffectiveGroupIds = narrowGroupIds([...currentAncestorPath, category])
  const newEffectiveGroupIds = narrowGroupIds([...newAncestorPath, category])

  const setsEqual = (a: number[], b: number[]): boolean => {
    if (a.length !== b.length) return false
    const sb = new Set(b)
    return a.every((x) => sb.has(x))
  }

  const hasChange =
    !setsEqual(oldEffectiveProgramIds, newEffectiveProgramIds) ||
    !setsEqual(oldEffectiveGroupIds, newEffectiveGroupIds)

  return {
    hasChange,
    oldEffectiveProgramIds,
    newEffectiveProgramIds,
    oldEffectiveGroupIds,
    newEffectiveGroupIds,
  }
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
