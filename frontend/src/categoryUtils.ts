/**
 * Shared utility for computing effective program restrictions via narrowing
 * (intersection) semantics on an ordered ancestor chain.
 *
 * Used by App.tsx, ManageCategoriesDialog, CategoryPickerSelect, and ManagePage.
 */

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
