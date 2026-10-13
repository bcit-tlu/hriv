import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
} from 'd3-force'
import type { GraphEdge, GraphModel, GraphNode } from './types'

/**
 * d3-force setup for the collections graph — the epic's locked physics
 * (#1627): soft links / firm collisions, charge restricted to hub +
 * collections + categories, no charge on images, and a temporary
 * short-range `dragRepel` around the dragged node instead of a global
 * boost. Mirrors prototype/collections-graph/index.html (`startGraph`,
 * `dragRepel`).
 *
 * `dragRepel` reads `dragState.node` — set it from the drag handlers
 * before registering the force.
 */
export interface GraphSimulation {
  sim: Simulation<GraphNode, GraphEdge>
  dragState: { node: GraphNode | null }
  /** Temporary radius-70 repulsion around `dragState.node`. */
  dragRepel: Force<GraphNode, GraphEdge>
}

const DRAG_REPEL_RADIUS = 70

function linkDistance(edge: GraphEdge): number {
  return edge.kind === 'hub' ? 120 : edge.kind === 'image' ? 22 : 60
}

function linkStrength(edge: GraphEdge): number {
  return edge.kind === 'hub' ? 0.08 : edge.kind === 'image' ? 0.25 : 0.15
}

function chargeStrength(node: GraphNode): number {
  return node.kind === 'hub' ? -600 : node.kind === 'category' ? -200 : -150
}

function collideRadius(node: GraphNode): number {
  return node.kind === 'hub' ? node.r + 10 : node.kind === 'image' ? node.r + 1.5 : node.r + 6
}

export function createGraphSimulation(
  model: GraphModel,
  onTick: () => void,
  onCooled: () => void,
): GraphSimulation {
  const dragState: { node: GraphNode | null } = { node: null }

  // Obsidian-style local parting: while dragging, this temporary force
  // pushes every node within 70 graph units of the dragged node — no
  // global image charge.
  const dragRepel: Force<GraphNode, GraphEdge> = (alpha: number) => {
    const dragged = dragState.node
    if (!dragged) return
    const r2 = DRAG_REPEL_RADIUS * DRAG_REPEL_RADIUS
    for (const n of model.nodes) {
      if (n === dragged || n.vx === undefined) continue
      const dx = n.x - dragged.x
      const dy = n.y - dragged.y
      const d2 = dx * dx + dy * dy
      if (d2 < r2 && d2 > 0.01) {
        const d = Math.sqrt(d2)
        const f = (alpha * 4 * (DRAG_REPEL_RADIUS - d)) / DRAG_REPEL_RADIUS / d
        n.vx = (n.vx ?? 0) + dx * f
        n.vy = (n.vy ?? 0) + dy * f
      }
    }
  }
  dragRepel.initialize = () => {}

  const sim = forceSimulation<GraphNode, GraphEdge>(model.nodes)
    .force(
      'link',
      // forceLink rewrites link.source/target from node indices into node
      // objects in place — give it a copy so `model.edges` stays index-based
      // for the renderer (and for remounts that re-simulate the same model).
      forceLink<GraphNode, GraphEdge>(model.edges.map((e) => ({ ...e })))
        .distance(linkDistance)
        .strength(linkStrength),
    )
    .force(
      'charge',
      forceManyBody<GraphNode>().strength(chargeStrength).theta(0.9).distanceMax(400),
    )
    .force('collide', forceCollide<GraphNode>(collideRadius).strength(1).iterations(2))
    .force(
      'x',
      forceX<GraphNode>(0).strength((n) => (n.kind === 'image' || n.kind === 'hub' ? 0 : 0.03)),
    )
    .force(
      'y',
      forceY<GraphNode>(0).strength((n) => (n.kind === 'image' || n.kind === 'hub' ? 0 : 0.03)),
    )
    .velocityDecay(0.45)
    .alphaDecay(0.03)
    .alphaMin(0.01)
    .on('tick', () => {
      onTick()
      if (sim.alpha() < sim.alphaMin()) {
        sim.stop()
        onCooled()
      }
    })

  // Charge only acts on hub + collections + categories: images carry no
  // charge and feel none — `force.initialize` restricts the subset.
  sim.force<ReturnType<typeof forceManyBody<GraphNode>>>('charge')?.initialize(
    model.nodes.filter((n) => n.kind !== 'image'),
    () => 0.5,
  )

  return { sim, dragState, dragRepel }
}

/**
 * Register the dragRepel force around `node` and reheat — call once the
 * pointer has actually moved (>1px from drag start). Pass `null` / call
 * `stopDragRepel` on drag end.
 */
export function startDragRepel(gs: GraphSimulation, node: GraphNode): void {
  gs.dragState.node = node
  gs.sim.alphaTarget(0.12).restart()
  gs.sim.force('dragRepel', gs.dragRepel)
}

export function stopDragRepel(gs: GraphSimulation): void {
  gs.dragState.node = null
  gs.sim.alphaTarget(0)
  gs.sim.force('dragRepel', null)
}

/**
 * Synchronous pre-ticks so the first fit lands on a roughly settled
 * layout (~40 ticks, 150 ms budget) — the only automatic fit in the
 * component happens right after this.
 */
export function preTick(
  sim: Simulation<GraphNode, GraphEdge>,
  maxTicks = 40,
  budgetMs = 150,
): void {
  const t0 = performance.now()
  let n = 0
  while (n < maxTicks && performance.now() - t0 < budgetMs) {
    sim.tick()
    n++
  }
}
