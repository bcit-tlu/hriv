import { arrayMove, move } from '@dnd-kit/helpers'
import type { DragEndEvent } from '@dnd-kit/react'

/**
 * Resolve the committed column order for a completed drag (#1577). `move`
 * derives the order from the drop target's sortable index; when the pointer
 * is released off every row the target is gone but the source still carries
 * its projected index — fall back to `arrayMove` on that projection, the
 * same fallback SortableTileGrid uses, so the previewed order still commits.
 * Returns `null` for canceled, unchanged, or unresolvable drops.
 */
export function resolveReorderedKeys<Key extends string>(
  ids: readonly Key[],
  event: DragEndEvent,
): Key[] | null {
  if (event.canceled) return null
  const { operation } = event
  let reordered: Key[]
  if (!operation.target) {
    const source = operation.source as { index?: unknown; initialIndex?: unknown } | undefined
    if (
      typeof source?.index !== 'number' ||
      typeof source.initialIndex !== 'number' ||
      source.index === source.initialIndex
    ) {
      return null
    }
    reordered = arrayMove([...ids], source.initialIndex, source.index)
  } else {
    reordered = move([...ids], event) as Key[]
  }
  if (reordered.length !== ids.length) return null
  if (reordered.every((id, i) => id === ids[i])) return null
  return reordered
}
