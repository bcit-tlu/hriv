import { describe, expect, it } from 'vitest'
import { buildCollectionGraphModel } from '../src/collectionsGraph/buildCollectionModel'
import { collectionRadius } from '../src/collectionsGraph/buildModel'
import type { ApiCollectionGraph } from '../src/api'

function coll(id: number, name = `Collection ${id}`, imageCount = 4) {
  return {
    id,
    name,
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

function payload(overrides: Partial<ApiCollectionGraph> = {}): ApiCollectionGraph {
  return {
    order: 1,
    collection: coll(1, 'Skull atlas'),
    images: [],
    related_collections: [],
    categories: [],
    ...overrides,
  }
}

describe('buildCollectionGraphModel', () => {
  it('makes the collection itself the hub with member images in order', () => {
    const m = buildCollectionGraphModel(
      payload({ images: [img(10, [1]), img(11, [1]), img(12, [1])] }),
    )

    const hub = m.nodes[0]
    expect(hub.kind).toBe('hub')
    expect(hub.id).toBe(1)
    expect(hub.label).toBe('Skull atlas')
    expect(hub.collection?.id).toBe(1)
    // Member order preserved; each image links back to the hub.
    expect(m.nodes.filter((n) => n.kind === 'image').map((n) => n.id)).toEqual([10, 11, 12])
    expect(m.edges).toHaveLength(3)
    expect(m.edges.every((e) => e.kind === 'image' && e.source === hub.i)).toBe(true)
    expect(m.stats.images).toBe(3)
  })

  it('flags images in ≥2 collections as shared at every order', () => {
    const m = buildCollectionGraphModel(payload({ images: [img(10, [1, 5]), img(11, [1])] }))
    expect(m.nodes.find((n) => n.id === 10)!.shared).toBe(true)
    expect(m.nodes.find((n) => n.id === 11)!.shared).toBe(false)
    expect(m.stats.shared).toBe(1)
  })

  it('order 2 adds related collection nodes with image edges', () => {
    const p = payload({
      order: 2,
      images: [img(10, [1, 5]), img(11, [1, 7]), img(12, [1])],
      related_collections: [coll(5, 'Pelvis set'), coll(7, 'Spine set')],
    })
    const m = buildCollectionGraphModel(p)

    const rels = m.nodes.filter((n) => n.kind === 'collection')
    expect(rels.map((n) => n.id)).toEqual([5, 7])
    expect(m.stats.relatedCollections).toBe(2)
    // hub→image (3) + image→related (10→5, 11→7); no edge for id 1.
    const imgEdges = m.edges.filter((e) => e.kind === 'image')
    expect(imgEdges).toHaveLength(5)
    const rel5 = rels.find((n) => n.id === 5)!
    const rel7 = rels.find((n) => n.id === 7)!
    const i10 = m.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    const i11 = m.nodes.find((n) => n.kind === 'image' && n.id === 11)!
    expect(imgEdges).toContainEqual({ source: i10.i, target: rel5.i, kind: 'image' })
    expect(imgEdges).toContainEqual({ source: i11.i, target: rel7.i, kind: 'image' })
    // Related collection radii come from collectionRadius (√image count).
    expect(rel5.r).toBeGreaterThanOrEqual(4)
  })

  it('sizes the hub on the collectionRadius scale like related collections (#1653)', () => {
    const p = payload({
      order: 2,
      collection: coll(1, 'Skull atlas', 6),
      images: [img(10, [1, 5])],
      related_collections: [coll(5, 'Pelvis set', 5)],
    })
    const m = buildCollectionGraphModel(p)

    const hub = m.nodes[0]
    expect(hub.r).toBe(collectionRadius(6))
    // A related collection with one fewer image sits within 1px of the
    // hub — the viewed collection no longer dwarfs its neighbours.
    const rel5 = m.nodes.find((n) => n.kind === 'collection' && n.id === 5)!
    expect(Math.abs(hub.r - rel5.r)).toBeLessThanOrEqual(1)
  })

  it('order 3 adds the hub members’ categories with image→category edges', () => {
    const p = payload({
      order: 3,
      images: [img(10, [1, 5], 7), img(11, [1], 8)],
      related_collections: [coll(5)],
      categories: [cat(7), cat(8)],
    })
    const m = buildCollectionGraphModel(p)
    const cat7 = m.nodes.find((n) => n.kind === 'category' && n.id === 7)!
    const cat8 = m.nodes.find((n) => n.kind === 'category' && n.id === 8)!
    const i10 = m.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    expect(m.edges).toContainEqual({ source: i10.i, target: cat7.i, kind: 'category' })
    expect(m.stats.categories).toBe(2)
    expect(cat7.isolated).toBe(false)
    expect(cat8.isolated).toBe(false)
  })

  it('carries settled positions from prev for shared (kind, id) nodes', () => {
    const p1 = payload({ images: [img(10, [1]), img(11, [1])] })
    const a = buildCollectionGraphModel(p1)
    const moved = a.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    moved.x = 321
    moved.y = -55

    // Order toggle on the same perspective: positions carry over.
    const p2 = payload({ order: 2, images: p1.images, related_collections: [] })
    const b = buildCollectionGraphModel(p2, a)
    expect([b.nodes.find((n) => n.id === 10)!.x, b.nodes.find((n) => n.id === 10)!.y]).toEqual([
      321, -55,
    ])

    // A different perspective (different hub id) reseeds everything.
    const pOther = payload({ collection: coll(9, 'Pelvis set'), images: [img(10, [9])] })
    const c = buildCollectionGraphModel(pOther, b)
    const c10 = c.nodes.find((n) => n.kind === 'image' && n.id === 10)!
    // Image 10 still carries over (same kind+id) — the dialog remounts the
    // canvas per perspective anyway, so only the hub/key differences matter.
    expect([c10.x, c10.y]).toEqual([321, -55])
    expect(c.nodes[0].id).toBe(9)
  })

  it('seeds deterministically', () => {
    const p = payload({ images: [img(10, [1]), img(11, [1])] })
    const a = buildCollectionGraphModel(p)
    const b = buildCollectionGraphModel(p)
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]))
  })
})
