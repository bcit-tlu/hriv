import type { Category, ImageItem } from '../types'

export interface FlatOption {
  id: number
  label: string
  depth: number
  childCount: number
  status: string | null
  parentId: number | null
  programIds: number[]
  inheritedRestriction: boolean
}

/** Collect images per parent from the category tree. */
export function collectImagesByParent(
  cats: Category[],
  uncategorized: ImageItem[],
): Map<string, ImageItem[]> {
  const map = new Map<string, ImageItem[]>()
  if (uncategorized.length > 0) {
    map.set('null', [...uncategorized].sort((a, b) => a.sortOrder - b.sortOrder))
  }
  function walk(nodes: Category[]) {
    for (const node of nodes) {
      if (node.images.length > 0) {
        map.set(String(node.id), [...node.images].sort((a, b) => a.sortOrder - b.sortOrder))
      }
      walk(node.children)
    }
  }
  walk(cats)
  return map
}

/**
 * Build an interleaved sort_order assignment for categories and images at each
 * parent level. For each parent, the old interleaved order (categories + images
 * sorted by sortOrder) is used as a template: category slots are replaced with
 * the new category order while image slots stay in place. If the number of
 * categories at a parent changed (cross-parent move), extra categories are
 * appended and removed slots are collapsed.
 */
export function interleavedSortOrders(
  newCatList: FlatOption[],
  oldCatList: FlatOption[],
  imagesByParent: Map<string, ImageItem[]>,
): {
  catItems: Array<{ id: number; parent_id: number | null; sort_order: number }>
  imgItems: Array<{ id: number; sort_order: number }>
} {
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

  const catItems: Array<{ id: number; parent_id: number | null; sort_order: number }> = []
  const imgItems: Array<{ id: number; sort_order: number }> = []

  // Collect all parent keys that appear in new categories OR have images
  const allParentKeys = new Set([...newByParent.keys(), ...imagesByParent.keys()])

  for (const parentKey of allParentKeys) {
    const newCats = newByParent.get(parentKey) ?? []
    const oldCats = oldByParent.get(parentKey) ?? []
    const images = imagesByParent.get(parentKey) ?? []

    if (images.length === 0) {
      // No images — dense category-only assignment
      newCats.forEach((c, i) => {
        catItems.push({ id: c.id, parent_id: c.parentId, sort_order: i })
      })
      continue
    }

    if (newCats.length === 0) {
      // No categories — dense image-only assignment
      images.forEach((img, i) => {
        imgItems.push({ id: img.id, sort_order: i })
      })
      continue
    }

    // Build the old interleaved template from old categories + images
    type Slot = { type: 'cat' | 'img'; sortOrder: number }
    const oldSlots: Slot[] = [
      ...oldCats.map((): Slot => ({ type: 'cat', sortOrder: -1 })),
      ...images.map((i): Slot => ({ type: 'img', sortOrder: i.sortOrder })),
    ]
    // Old categories don't carry a meaningful sortOrder in FlatOption,
    // so infer positions: they occupied the gaps left by images in [0, N)
    let catPos = 0
    const imgSortOrders = new Set(images.map(i => i.sortOrder))
    for (const slot of oldSlots) {
      if (slot.type === 'cat') {
        while (imgSortOrders.has(catPos)) catPos++
        slot.sortOrder = catPos
        catPos++
      }
    }
    oldSlots.sort((a, b) => a.sortOrder - b.sortOrder)

    // Replace category slots with new categories in order; collapse/append
    // if the count changed (cross-parent move)
    const result: Array<{ type: 'cat' | 'img'; catIdx?: number; imgIdx?: number }> = []
    let newCatIdx = 0
    let imgIdx = 0
    for (const slot of oldSlots) {
      if (slot.type === 'img') {
        result.push({ type: 'img', imgIdx: imgIdx++ })
      } else if (newCatIdx < newCats.length) {
        result.push({ type: 'cat', catIdx: newCatIdx++ })
      }
      // else: category was moved away — slot collapses
    }
    // Append any extra categories (moved into this parent)
    while (newCatIdx < newCats.length) {
      result.push({ type: 'cat', catIdx: newCatIdx++ })
    }

    // Assign sequential sort_orders
    result.forEach((item, i) => {
      if (item.type === 'cat') {
        const c = newCats[item.catIdx!]
        catItems.push({ id: c.id, parent_id: c.parentId, sort_order: i })
      } else {
        imgItems.push({ id: images[item.imgIdx!].id, sort_order: i })
      }
    })
  }

  return { catItems, imgItems }
}
