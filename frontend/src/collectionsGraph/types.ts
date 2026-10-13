import type {
  ApiCollectionGraphCategory,
  ApiCollectionGraphImage,
  ApiCollectionGraphNode,
} from '../api'

/**
 * One node in the collections graph model (#1629). Kinds mirror the
 * payload: `hub` is the synthetic "Collections" root, `collection`,
 * `image` and `category` map to payload entries. `x`/`y`/`vx`/`vy` are
 * d3-force simulation state — they start as deterministic seeded
 * positions (`buildModel`) and are mutated by the simulation.
 */
export interface GraphNode {
  /** Index into `GraphModel.nodes`. */
  i: number
  kind: 'hub' | 'collection' | 'image' | 'category'
  /** Node id in its domain (collection/image/category id); NaN for hub. */
  id: number
  label: string
  r: number
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  /** Payload ref — present for the matching kind. */
  collection?: ApiCollectionGraphNode
  image?: ApiCollectionGraphImage
  category?: ApiCollectionGraphCategory
  /** Surviving collections containing this image (trimmed to the list). */
  imageCollectionIds?: number[]
  /** Image is in ≥2 surviving collections (drawn larger / accent). */
  shared?: boolean
  /** Category with no edge to any image in the graph ("no collection yet"). */
  isolated?: boolean
  /**
   * "Shared only" view: single-collection images stay in the model and
   * simulation but are neither drawn nor hit-tested.
   */
  hidden?: boolean
}

export interface GraphEdge {
  /** Index into `GraphModel.nodes` for both endpoints. */
  source: number
  target: number
  kind: 'hub' | 'image' | 'category'
}

export interface GraphModel {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Stats for the caption under the canvas. */
  stats: {
    collections: number
    images: number
    shared: number
    categories: number
    /** Order-3 categories with no connected image ("without a collection"). */
    unconnectedCategories: number
    /** Related collections — only set by the single-collection perspective
     *  model (#1630). */
    relatedCollections?: number
    order: number
  }
}
