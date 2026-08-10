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
function narrowProgramsWithState(ancestors: ReadonlyArray<{ programIds: number[] }>): {
  ids: number[]
  initialized: boolean
} {
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
  return { ids: effective, initialized }
}

export function narrowProgramIds(ancestors: ReadonlyArray<{ programIds: number[] }>): number[] {
  return narrowProgramsWithState(ancestors).ids
}

/**
 * Group analogue of {@link narrowProgramIds}. Groups are an independent
 * visibility dimension from programs, but inherit the same ancestor-cascade
 * (narrowing) semantics: a child can never widen its group restriction beyond
 * what its ancestors allow.
 */
function narrowGroupsWithState(ancestors: ReadonlyArray<{ groupIds: number[] }>): {
  ids: number[]
  initialized: boolean
} {
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
  return { ids: effective, initialized }
}

export function narrowGroupIds(ancestors: ReadonlyArray<{ groupIds: number[] }>): number[] {
  return narrowGroupsWithState(ancestors).ids
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
  /** Whether any program restriction applied at the old location. */
  oldProgramsInitialized: boolean
  /** Effective program IDs at the new location (inherited + direct narrowing). */
  newEffectiveProgramIds: number[]
  /** Whether any program restriction applies at the new location. */
  newProgramsInitialized: boolean
  /** Effective group IDs at the old location (inherited + direct narrowing). */
  oldEffectiveGroupIds: number[]
  /** Whether any group restriction applied at the old location. */
  oldGroupsInitialized: boolean
  /** Effective group IDs at the new location (inherited + direct narrowing). */
  newEffectiveGroupIds: number[]
  /** Whether any group restriction applies at the new location. */
  newGroupsInitialized: boolean
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
  const oldPrograms = narrowProgramsWithState([...currentAncestorPath, category])
  const newPrograms = narrowProgramsWithState([...newAncestorPath, category])
  const oldGroups = narrowGroupsWithState([...currentAncestorPath, category])
  const newGroups = narrowGroupsWithState([...newAncestorPath, category])

  const setsEqual = (a: number[], b: number[]): boolean => {
    if (a.length !== b.length) return false
    const sb = new Set(b)
    return a.every((x) => sb.has(x))
  }

  const hasChange =
    oldPrograms.initialized !== newPrograms.initialized ||
    oldGroups.initialized !== newGroups.initialized ||
    !setsEqual(oldPrograms.ids, newPrograms.ids) ||
    !setsEqual(oldGroups.ids, newGroups.ids)

  return {
    hasChange,
    oldEffectiveProgramIds: oldPrograms.ids,
    oldProgramsInitialized: oldPrograms.initialized,
    newEffectiveProgramIds: newPrograms.ids,
    newProgramsInitialized: newPrograms.initialized,
    oldEffectiveGroupIds: oldGroups.ids,
    oldGroupsInitialized: oldGroups.initialized,
    newEffectiveGroupIds: newGroups.ids,
    newGroupsInitialized: newGroups.initialized,
  }
}

/**
 * Find descendant categories whose own program restrictions are incompatible
 * with a proposed new parent program restriction set.
 *
 * A descendant is "incompatible" when it has at least one `programId` of its
 * own AND none of those IDs appear in `newParentProgramIds`.  In that case the
 * narrowing intersection at the descendant would become empty, making it
 * invisible to all students via the program dimension.
 *
 * Returns the labels of every incompatible descendant (in depth-first order).
 */
interface DescendantNode {
  label: string
  programIds: number[]
  groupIds?: number[]
  children: DescendantNode[]
}

export function findIncompatibleDescendants(
  children: ReadonlyArray<DescendantNode>,
  newParentProgramIds: number[],
): string[] {
  if (newParentProgramIds.length === 0) return []
  const newSet = new Set(newParentProgramIds)
  const affected: string[] = []

  function walk(nodes: ReadonlyArray<DescendantNode>): void {
    for (const node of nodes) {
      if (node.programIds.length > 0 && !node.programIds.some((id) => newSet.has(id))) {
        affected.push(node.label)
      }
      walk(node.children)
    }
  }

  walk(children)
  return affected
}

/**
 * Find descendant categories whose own group restrictions are incompatible
 * with a proposed new parent group restriction set.
 *
 * A descendant is "incompatible" when it has at least one `groupId` of its
 * own AND none of those IDs appear in `newParentGroupIds`. In that case the
 * narrowing intersection at the descendant would become empty, making it
 * invisible to all students via the group dimension.
 *
 * Returns the labels of every incompatible descendant (in depth-first order).
 */
export function findIncompatibleDescendantsByGroup(
  children: ReadonlyArray<DescendantNode>,
  newParentGroupIds: number[],
): string[] {
  if (newParentGroupIds.length === 0) return []
  const newSet = new Set(newParentGroupIds)
  const affected: string[] = []

  function walk(nodes: ReadonlyArray<DescendantNode>): void {
    for (const node of nodes) {
      const groupIds = node.groupIds ?? []
      if (groupIds.length > 0 && !groupIds.some((id) => newSet.has(id))) {
        affected.push(node.label)
      }
      walk(node.children)
    }
  }

  walk(children)
  return affected
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
