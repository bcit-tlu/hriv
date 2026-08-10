import type { Category, ImageItem } from '../types'
import type { TileOrderItemRef } from '../api'
import type { FlatCategoryOption } from './categoryOptionUtils'

export type FlatOption = FlatCategoryOption

/** A category whose parent changed in a Manage Categories drop. */
export interface ParentMove {
  categoryId: number
  newParentId: number | null
}

/** The full interleaved tile order for one ordering scope (parent category). */
export interface ScopeOrder {
  scope: number | null
  order: TileOrderItemRef[]
}

/** Categories whose parent differs between the old and the dropped list. */
export function diffParentMoves(newCatList: FlatOption[], oldCatList: FlatOption[]): ParentMove[] {
  const oldParentById = new Map(oldCatList.map((o) => [o.id, o.parentId]))
  return newCatList
    .filter((o) => oldParentById.has(o.id) && oldParentById.get(o.id) !== o.parentId)
    .map((o) => ({ categoryId: o.id, newParentId: o.parentId }))
}

/**
 * Re-derive the flat option list's sibling ordering from the coordinator's
 * per-scope display orders, so the dialog reflects optimistic/pending order
 * instead of snapping back to the last-loaded `sort_order` while a save is
 * in flight. Categories not present in a scope's display order (e.g. a
 * category whose parent move is still refreshing) keep their original slot
 * so they do not visibly jump while the reload is in flight.
 */
export function reorderFlatOptions(
  options: FlatOption[],
  displayOrderFor: (parentId: number | null) => TileOrderItemRef[] | null,
): FlatOption[] {
  const byParent = new Map<string, FlatOption[]>()
  for (const opt of options) {
    const key = String(opt.parentId)
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(opt)
  }

  const result: FlatOption[] = []
  const emit = (parentId: number | null) => {
    const siblings = byParent.get(String(parentId)) ?? []
    if (siblings.length === 0) return
    const displayOrder = displayOrderFor(parentId)
    let ordered = siblings
    if (displayOrder) {
      const rank = new Map<number, number>()
      displayOrder.forEach((ref, i) => {
        if (ref.type === 'category') rank.set(ref.id, i)
      })
      const ranked = siblings
        .filter((s) => rank.has(s.id))
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
      let rankedIdx = 0
      ordered = siblings.map((s) => (rank.has(s.id) ? ranked[rankedIdx++] : s))
    }
    for (const opt of ordered) {
      result.push(opt)
      emit(opt.id)
    }
  }
  emit(null)
  return result
}

/** Collect images per parent from the category tree. */
export function collectImagesByParent(
  cats: Category[],
  uncategorized: ImageItem[],
): Map<string, ImageItem[]> {
  const map = new Map<string, ImageItem[]>()
  if (uncategorized.length > 0) {
    map.set(
      'null',
      [...uncategorized].sort((a, b) => a.sortOrder - b.sortOrder),
    )
  }
  function walk(nodes: Category[]) {
    for (const node of nodes) {
      if (node.images.length > 0) {
        map.set(
          String(node.id),
          [...node.images].sort((a, b) => a.sortOrder - b.sortOrder),
        )
      }
      walk(node.children)
    }
  }
  walk(cats)
  return map
}

function sameRefs(a: TileOrderItemRef[], b: TileOrderItemRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.type === b[i].type && ref.id === b[i].id)
}

/**
 * Build the full interleaved tile order per ordering scope for the atomic
 * `PUT /api/tile-order` contract (docs/tile-ordering.md). For each parent,
 * the old interleaved order (categories + images sorted by sortOrder) is
 * used as a template: category slots are replaced with the new category
 * order while image slots stay in place. If the number of categories at a
 * parent changed (cross-parent move), extra categories are appended and
 * removed slots are collapsed. Only scopes whose resulting order differs
 * from the old order are returned; scopes left with no members are skipped.
 *
 * When `displayOrderFor` returns an order for a scope (the coordinator's
 * newest local/pending order), it is used as the template instead of the
 * last-loaded `sortOrder`, so a category-only reorder never reverts a
 * pending image reorder for the same scope.
 */
export function interleavedTileOrders(
  newCatList: FlatOption[],
  oldCatList: FlatOption[],
  imagesByParent: Map<string, ImageItem[]>,
  displayOrderFor?: (parentId: number | null) => TileOrderItemRef[] | null,
): ScopeOrder[] {
  // Group categories by parent (preserving list order)
  const groupByParent = (list: FlatOption[]) => {
    const m = new Map<string, FlatOption[]>()
    for (const item of list) {
      const key = String(item.parentId)
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(item)
    }
    return m
  }
  const newByParent = groupByParent(newCatList)
  const oldByParent = groupByParent(oldCatList)

  // Collect all parent keys that appear in old or new categories OR have
  // images (a scope all categories left still needs its remaining order).
  const allParentKeys = new Set([
    ...newByParent.keys(),
    ...oldByParent.keys(),
    ...imagesByParent.keys(),
  ])

  const scopes: ScopeOrder[] = []
  for (const parentKey of allParentKeys) {
    const newCats = newByParent.get(parentKey) ?? []
    const oldCats = oldByParent.get(parentKey) ?? []
    const images = imagesByParent.get(parentKey) ?? []
    const parentId = parentKey === 'null' ? null : Number(parentKey)

    const display = displayOrderFor?.(parentId)
    if (display && display.length > 0) {
      // Use the coordinator's newest order as the template: keep only
      // current members, then append members it doesn't know about yet.
      const oldCatIds = new Set(oldCats.map((c) => c.id))
      const imageIds = new Set(images.map((i) => i.id))
      const template = display.filter((ref) =>
        ref.type === 'category' ? oldCatIds.has(ref.id) : imageIds.has(ref.id),
      )
      // An entirely-stale coordinator order (no current members) carries no
      // interleaving information — fall back to the sortOrder template.
      if (template.length > 0) {
        const seenCats = new Set(template.filter((r) => r.type === 'category').map((r) => r.id))
        const seenImgs = new Set(template.filter((r) => r.type === 'image').map((r) => r.id))
        for (const cat of oldCats) {
          if (!seenCats.has(cat.id)) template.push({ type: 'category', id: cat.id })
        }
        for (const img of images) {
          if (!seenImgs.has(img.id)) template.push({ type: 'image', id: img.id })
        }

        const newOrder: TileOrderItemRef[] = []
        let newCatIdx = 0
        for (const ref of template) {
          if (ref.type === 'image') {
            newOrder.push(ref)
          } else if (newCatIdx < newCats.length) {
            newOrder.push({ type: 'category', id: newCats[newCatIdx++].id })
          }
        }
        while (newCatIdx < newCats.length) {
          newOrder.push({ type: 'category', id: newCats[newCatIdx++].id })
        }

        if (newOrder.length === 0 || sameRefs(template, newOrder)) continue
        scopes.push({ scope: parentId, order: newOrder })
        continue
      }
    }

    // Build the old interleaved template from old categories + images.
    // Old categories don't carry a meaningful sortOrder in FlatOption,
    // so infer positions: they occupied the gaps left by images in [0, N)
    type Slot = { type: 'cat' | 'img'; index: number; sortOrder: number }
    const oldSlots: Slot[] = [
      ...oldCats.map((_, i): Slot => ({ type: 'cat', index: i, sortOrder: -1 })),
      ...images.map((img, i): Slot => ({ type: 'img', index: i, sortOrder: img.sortOrder })),
    ]
    let catPos = 0
    const imgSortOrders = new Set(images.map((i) => i.sortOrder))
    for (const slot of oldSlots) {
      if (slot.type === 'cat') {
        while (imgSortOrders.has(catPos)) catPos++
        slot.sortOrder = catPos
        catPos++
      }
    }
    oldSlots.sort((a, b) => a.sortOrder - b.sortOrder)

    const oldOrder: TileOrderItemRef[] = oldSlots.map((slot) =>
      slot.type === 'cat'
        ? { type: 'category', id: oldCats[slot.index].id }
        : { type: 'image', id: images[slot.index].id },
    )

    // Replace category slots with new categories in order; collapse/append
    // if the count changed (cross-parent move)
    const newOrder: TileOrderItemRef[] = []
    let newCatIdx = 0
    for (const slot of oldSlots) {
      if (slot.type === 'img') {
        newOrder.push({ type: 'image', id: images[slot.index].id })
      } else if (newCatIdx < newCats.length) {
        newOrder.push({ type: 'category', id: newCats[newCatIdx++].id })
      }
      // else: category was moved away — slot collapses
    }
    while (newCatIdx < newCats.length) {
      newOrder.push({ type: 'category', id: newCats[newCatIdx++].id })
    }

    if (newOrder.length === 0 || sameRefs(oldOrder, newOrder)) continue
    scopes.push({ scope: parentId, order: newOrder })
  }

  return scopes
}
