import type { ApiCollectionGraph } from '../api'
import { collectionRadius } from './buildModel'
import type { GraphEdge, GraphModel, GraphNode } from './types'

const GOLDEN_ANGLE = 2.399963

/**
 * Build the single-collection perspective model for the Graph View dialog
 * (#1630): the hub IS the collection (`kind: 'hub'` carrying the payload
 * node so the type chip/owner tooltip still works), sized on the same
 * `collectionRadius` scale as related collections (#1653), spokes are
 * its member images in member order. Order ≥2 adds one `collection` node per
 * `related_collections` entry with image→collection edges; order 3 adds
 * the members' categories.
 *
 * Seeding mirrors `buildGraphModel`: images on a r-60 ring around the
 * hub, related collections on r-160, categories on r-220 — deterministic,
 * near the solution. `prev` carries settled positions for shared
 * `(kind, id)` nodes so an order toggle does not bounce the layout; the
 * dialog passes `prev` only when the perspective id is unchanged.
 */
export function buildCollectionGraphModel(
  payload: ApiCollectionGraph,
  prev?: GraphModel,
): GraphModel {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const order = payload.order
  const hubId = payload.collection.id

  const hub: GraphNode = {
    i: 0,
    kind: 'hub',
    id: hubId,
    label: payload.collection.name,
    r: collectionRadius(payload.collection.image_count),
    x: 0,
    y: 0,
    collection: payload.collection,
  }
  nodes.push(hub)

  const imageIndex = new Map<number, GraphNode>()
  let shared = 0
  payload.images.forEach((img, idx) => {
    const a = idx * GOLDEN_ANGLE
    const isShared = img.collection_ids.length >= 2
    if (isShared) shared++
    const node: GraphNode = {
      i: nodes.length,
      kind: 'image',
      id: img.id,
      label: img.name,
      r: 4,
      x: Math.cos(a) * 60,
      y: Math.sin(a) * 60,
      image: img,
      imageCollectionIds: img.collection_ids,
      shared: isShared,
    }
    imageIndex.set(img.id, node)
    nodes.push(node)
    edges.push({ source: hub.i, target: node.i, kind: 'image' })
  })

  let relatedCollections = 0
  if (order >= 2) {
    payload.related_collections.forEach((c, i) => {
      const a = i * GOLDEN_ANGLE
      const node: GraphNode = {
        i: nodes.length,
        kind: 'collection',
        id: c.id,
        label: c.name,
        r: collectionRadius(c.image_count),
        x: Math.cos(a) * 160,
        y: Math.sin(a) * 160,
        collection: c,
      }
      nodes.push(node)
      relatedCollections++
    })
    const relatedById = new Map<number, GraphNode>(
      nodes.filter((n) => n.kind === 'collection').map((n) => [n.id, n]),
    )
    for (const imgNode of imageIndex.values()) {
      for (const collId of imgNode.imageCollectionIds ?? []) {
        if (collId === hubId) continue
        const rel = relatedById.get(collId)
        if (rel) edges.push({ source: imgNode.i, target: rel.i, kind: 'image' })
      }
    }
  }

  let unconnectedCategories = 0
  if (order >= 3) {
    const categoryIndex = new Map<number, GraphNode>()
    payload.categories.forEach((cat, i) => {
      const a = i * GOLDEN_ANGLE
      const node: GraphNode = {
        i: nodes.length,
        kind: 'category',
        id: cat.id,
        label: cat.label,
        r: Math.max(6, Math.min(18, Math.sqrt(cat.image_count) * 2)),
        x: Math.cos(a) * 220,
        y: Math.sin(a) * 220,
        category: cat,
      }
      categoryIndex.set(cat.id, node)
      nodes.push(node)
    })
    for (const imgNode of imageIndex.values()) {
      const catId = imgNode.image?.category_id
      if (catId == null) continue
      const catNode = categoryIndex.get(catId)
      if (!catNode) continue
      edges.push({ source: imgNode.i, target: catNode.i, kind: 'category' })
    }
    const connected = new Set(edges.filter((e) => e.kind === 'category').map((e) => e.target))
    for (const catNode of categoryIndex.values()) {
      catNode.isolated = !connected.has(catNode.i)
      if (catNode.isolated) unconnectedCategories++
    }
  }

  if (prev != null) {
    const prevByKey = new Map<string, GraphNode>(prev.nodes.map((n) => [`${n.kind}:${n.id}`, n]))
    for (const n of nodes) {
      const old = prevByKey.get(`${n.kind}:${n.id}`)
      if (old != null) {
        n.x = old.x
        n.y = old.y
        n.vx = old.vx
        n.vy = old.vy
      }
    }
  }

  return {
    nodes,
    edges,
    stats: {
      collections: 0,
      images: imageIndex.size,
      shared,
      categories: order >= 3 ? payload.categories.length : 0,
      unconnectedCategories,
      relatedCollections,
      order,
    },
  }
}
