import { describe, expect, it } from 'vitest'
import { buildGraphModel, collectionRadius } from '../src/collectionsGraph/buildModel'
import type { ApiCollectionsGraph } from '../src/api'

function coll(id: number, imageCount = 4) {
  return {
    id,
    name: `Collection ${id}`,
    type: 'sequence' as const,
    image_count: imageCount,
    hidden: false,
    category_id: null,
  }
}

function img(id: number, collectionIds: number[], categoryId: number | null = null) {
  return { id, name: `Image ${id}`, collection_ids: collectionIds, category_id: categoryId }
}

function cat(id: number, imageCount = 3) {
  return { id, label: `Category ${id}`, path: `Root › Category ${id}`, image_count: imageCount }
}

function payload(overrides: Partial<ApiCollectionsGraph> = {}): ApiCollectionsGraph {
  return { order: 1, collections: [], images: [], categories: [], ...overrides }
}

const ALL = (p: ApiCollectionsGraph) => new Set(p.collections.map((c) => c.id))

describe('buildGraphModel', () => {
  it('builds a hub plus one node per surviving collection, order 1', () => {
    const p = payload({ collections: [coll(1), coll(2), coll(3)] })
    const m = buildGraphModel(p, ALL(p), false)

    expect(m.nodes.map((n) => n.kind)).toEqual(['hub', 'collection', 'collection', 'collection'])
    expect(m.nodes[0].label).toBe('Collections')
    expect(m.edges).toHaveLength(3)
    expect(m.edges.every((e) => e.kind === 'hub' && e.source === 0)).toBe(true)
    expect(m.stats).toMatchObject({ collections: 3, images: 0, shared: 0, order: 1 })
  })

  it('filters collections to the visible id set', () => {
    const p = payload({ collections: [coll(1), coll(2), coll(3)] })
    const m = buildGraphModel(p, new Set([1, 3]), false)

    expect(m.nodes.filter((n) => n.kind === 'collection').map((n) => n.id)).toEqual([1, 3])
    expect(m.stats.collections).toBe(2)
  })

  it('trims image collection_ids and detects shared images', () => {
    const p = payload({
      order: 2,
      collections: [coll(1), coll(2)],
      images: [img(10, [1, 2]), img(11, [1]), img(12, [1, 99])],
    })
    const m = buildGraphModel(p, new Set([1, 2]), false)

    const n10 = m.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    const n11 = m.nodes.find((n) => n.kind === 'image' && n.id === 11)!
    const n12 = m.nodes.find((n) => n.kind === 'image' && n.id === 12)!
    expect(n10.shared).toBe(true)
    expect(n10.imageCollectionIds).toEqual([1, 2])
    expect(n11.shared).toBe(false)
    // 99 is not a surviving collection — trimmed, so 12 is not shared.
    expect(n12.imageCollectionIds).toEqual([1])
    expect(n12.shared).toBe(false)
    expect(m.stats).toMatchObject({ images: 3, shared: 1 })
    // 2 edges for the shared image, 1 each for the leaves.
    expect(m.edges.filter((e) => e.kind === 'image')).toHaveLength(4)
  })

  it('drops images whose collections all filtered out', () => {
    const p = payload({
      order: 2,
      collections: [coll(1), coll(2)],
      images: [img(10, [1]), img(11, [2])],
    })
    const m = buildGraphModel(p, new Set([1]), false)

    expect(m.nodes.filter((n) => n.kind === 'image').map((n) => n.id)).toEqual([10])
  })

  it('sharedOnly hides single-collection images but keeps them in the model', () => {
    const p = payload({
      order: 2,
      collections: [coll(1), coll(2)],
      images: [img(10, [1, 2]), img(11, [1])],
    })
    const m = buildGraphModel(p, ALL(p), true)

    const n10 = m.nodes.find((n) => n.id === 10)!
    const n11 = m.nodes.find((n) => n.id === 11)!
    expect(n10.hidden).toBeFalsy()
    expect(n11.hidden).toBe(true)
    // Still simulated and still edged — visibility is render-side only.
    expect(m.edges.filter((e) => e.kind === 'image')).toHaveLength(3)
  })

  it('order 3 adds every category, marks isolated ones, counts U', () => {
    const p = payload({
      order: 3,
      collections: [coll(1)],
      images: [img(10, [1], 7)],
      categories: [cat(7), cat(8)],
    })
    const m = buildGraphModel(p, ALL(p), false)

    const c7 = m.nodes.find((n) => n.kind === 'category' && n.id === 7)!
    const c8 = m.nodes.find((n) => n.kind === 'category' && n.id === 8)!
    expect(c7.isolated).toBeFalsy()
    // Category 8 has images in no collection — the "not yet transitioned"
    // signal; present but isolated.
    expect(c8.isolated).toBe(true)
    expect(m.stats.categories).toBe(2)
    expect(m.stats.unconnectedCategories).toBe(1)
    expect(m.edges.filter((e) => e.kind === 'category')).toHaveLength(1)
  })

  it('keeps category nodes visible under sharedOnly', () => {
    const p = payload({
      order: 3,
      collections: [coll(1)],
      images: [img(10, [1], 7)],
      categories: [cat(7)],
    })
    const m = buildGraphModel(p, ALL(p), true)

    const c7 = m.nodes.find((n) => n.kind === 'category')!
    expect(c7.hidden).toBeFalsy()
    expect(m.nodes.find((n) => n.kind === 'image')!.hidden).toBe(true)
  })

  it('seeds deterministic positions', () => {
    const p = payload({
      order: 2,
      collections: [coll(1), coll(2)],
      images: [img(10, [1])],
    })
    const a = buildGraphModel(p, ALL(p), false)
    const b = buildGraphModel(p, ALL(p), false)

    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]))
    // Collections sit on a spiral around the origin-centred hub.
    const hub = a.nodes[0]
    expect(hub.x).toBe(0)
    expect(hub.y).toBe(0)
    for (const n of a.nodes.slice(1)) {
      expect(Math.hypot(n.x - hub.x, n.y - hub.y)).toBeGreaterThan(0)
    }
  })

  it('carries settled positions from prev for nodes sharing (kind, id)', () => {
    const p = payload({
      order: 2,
      collections: [coll(1), coll(2)],
      images: [img(10, [1, 2]), img(11, [1])],
    })
    const a = buildGraphModel(p, ALL(p), false)
    const moved = a.nodes.find((n) => n.kind === 'collection' && n.id === 1)!
    moved.x = 555
    moved.y = -42
    moved.vx = 3
    moved.vy = -1
    a.nodes[0].x = 7

    // A sharedOnly rebuild keeps every (kind, id) — positions survive.
    const b = buildGraphModel(p, ALL(p), true, a)
    const moved2 = b.nodes.find((n) => n.kind === 'collection' && n.id === 1)!
    expect([moved2.x, moved2.y, moved2.vx, moved2.vy]).toEqual([555, -42, 3, -1])
    expect(b.nodes[0].x).toBe(7)
    const img10a = a.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    const img10b = b.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    expect([img10b.x, img10b.y]).toEqual([img10a.x, img10a.y])

    // Nodes new to the next model (order 3 categories) still get seeds.
    const p3 = payload({
      order: 3,
      collections: p.collections,
      images: p.images.map((i) => ({ ...i, category_id: 9 })),
      categories: [cat(9)],
    })
    const c = buildGraphModel(p3, ALL(p3), false, b)
    const cat9 = c.nodes.find((n) => n.kind === 'category')!
    expect(Math.hypot(cat9.x, cat9.y)).toBeGreaterThan(0)
  })
})

describe('collectionRadius', () => {
  it('scales with sqrt(image count) within the clamps', () => {
    expect(collectionRadius(0)).toBe(4)
    expect(collectionRadius(1)).toBe(4)
    expect(collectionRadius(16)).toBe(6)
    expect(collectionRadius(100)).toBe(14)
    expect(collectionRadius(10000)).toBe(14)
  })
})
