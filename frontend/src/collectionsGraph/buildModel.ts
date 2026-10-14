import type { ApiCollectionsGraph } from '../api'
import type { GraphEdge, GraphModel, GraphNode } from './types'

const GOLDEN_ANGLE = 2.399963

/**
 * Hub+collection identity of a model (#1636): when two models share the
 * same collection id set, `prev` already carried every shared node's
 * position, so the component can skip pre-ticking — nothing would jump.
 */
export function graphSpineKey(model: GraphModel): string {
  return model.nodes
    .filter((n) => n.kind === 'collection')
    .map((n) => n.id)
    .sort((a, b) => a - b)
    .join(',')
}

/**
 * Collection radius = 4 + 1.5·√count, capped at 16 — monotonic below the
 * cap (reached at 64 images) so one more image is a (slightly) bigger
 * node; no floor plateau (#1653).
 */
export function collectionRadius(imageCount: number): number {
  return Math.min(16, 4 + Math.sqrt(imageCount) * 1.5)
}

/**
 * Build the deterministic graph model for `CollectionsGraph` (#1629).
 *
 * Node set rule: collections are `payload.collections ∩
 * visibleCollectionIds` — the caller passes the ids of the rows currently
 * in the Collections list, so the shared filter bar (type / mine / owner)
 * reaches the graph here; the payload carries no owner info of its own.
 * Images survive only when ≥1 of their `collection_ids` survives;
 * `imageCollectionIds` is trimmed to those ids and `shared` means ≥2.
 * `order=3` categories are all of `payload.categories` (isolated ones
 * included — that is the point), with an edge image→category when
 * `category_id` matches. `sharedOnly` marks single-collection images
 * `hidden` — kept in the model/simulation, not drawn, not hit-tested.
 *
 * Seeding is deterministic: collections on a golden-angle spiral around
 * the hub, images on a small ring around their first collection, and
 * categories on an outer ring, so the simulation starts near a solution.
 *
 * `prev` carries settled positions into a rebuild (#1636): every node
 * whose `(kind, id)` exists in `prev` keeps its `x/y/vx/vy` instead of
 * the deterministic seed, so refetches and Shared-only toggles do not
 * bounce the layout.
 */
export function buildGraphModel(
  payload: ApiCollectionsGraph,
  visibleCollectionIds: ReadonlySet<number>,
  sharedOnly: boolean,
  prev?: GraphModel,
): GraphModel {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const order = payload.order

  const hub: GraphNode = {
    i: 0,
    kind: 'hub',
    id: Number.NaN,
    label: 'Collections',
    r: 40,
    x: 0,
    y: 0,
  }
  nodes.push(hub)

  const collectionIndex = new Map<number, GraphNode>()
  let collSlot = 0
  for (const c of payload.collections) {
    if (!visibleCollectionIds.has(c.id)) continue
    const i = collSlot++
    const ang = i * GOLDEN_ANGLE
    const node: GraphNode = {
      i: nodes.length,
      kind: 'collection',
      id: c.id,
      label: c.name,
      r: collectionRadius(c.image_count),
      x: Math.cos(ang) * (140 + i * 0.6),
      y: Math.sin(ang) * (140 + i * 0.6),
      collection: c,
    }
    collectionIndex.set(c.id, node)
    nodes.push(node)
    edges.push({ source: hub.i, target: node.i, kind: 'hub' })
  }

  const imageIndex = new Map<number, GraphNode>()
  let shared = 0
  if (order >= 2) {
    for (const img of payload.images) {
      const surviving = img.collection_ids.filter((id) => collectionIndex.has(id))
      if (surviving.length === 0) continue
      const first = collectionIndex.get(surviving[0])
      const idx = imageIndex.size
      const a = idx * GOLDEN_ANGLE
      const rr = 18 + (idx % 3) * 4
      const isShared = surviving.length >= 2
      if (isShared) shared++
      const node: GraphNode = {
        i: nodes.length,
        kind: 'image',
        id: img.id,
        label: img.name,
        r: isShared ? 4 : 2.5,
        // start on a small ring around the first collection — the sim
        // begins near the solution instead of exploding images outward
        x: (first?.x ?? 0) + Math.cos(a) * rr,
        y: (first?.y ?? 0) + Math.sin(a) * rr,
        image: img,
        imageCollectionIds: surviving,
        shared: isShared,
        hidden: sharedOnly && !isShared,
      }
      imageIndex.set(img.id, node)
      nodes.push(node)
      for (const collId of surviving) {
        edges.push({ source: collectionIndex.get(collId)!.i, target: node.i, kind: 'image' })
      }
    }
  }

  let unconnectedCategories = 0
  if (order >= 3) {
    const categoryIndex = new Map<number, GraphNode>()
    payload.categories.forEach((cat, i) => {
      const ang = i * GOLDEN_ANGLE
      const rr = 320 + (i % 8) * 16
      const node: GraphNode = {
        i: nodes.length,
        kind: 'category',
        id: cat.id,
        label: cat.label,
        r: Math.max(6, Math.min(18, Math.sqrt(cat.image_count) * 2)),
        x: Math.cos(ang) * rr,
        y: Math.sin(ang) * rr,
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
      collections: collectionIndex.size,
      images: imageIndex.size,
      shared,
      categories: payload.categories.length,
      unconnectedCategories,
      order,
    },
  }
}
