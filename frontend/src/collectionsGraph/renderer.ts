import { alpha } from '@mui/material/styles'
import { quadtree, type Quadtree } from 'd3-quadtree'
import type { ZoomTransform } from 'd3-zoom'
import type { GraphEdge, GraphModel, GraphNode } from './types'

/**
 * Palette the canvas renderer paints with — resolved from
 * `getThemePalette(mode)` by the React component so the graph follows the
 * colour mode (#1629). Fields map onto the prototype's hex constants.
 */
export interface GraphPalette {
  hub: string
  hubLabel: string
  collection: string
  syncRing: string
  image: string
  imageStroke: string
  imageShared: string
  imageSharedStroke: string
  category: string
  categoryFill: string
  selectionRing: string
  label: string
  edgeNormal: string
  edgeDim: string
  edgeImgNormal: string
  edgeImgDim: string
  edgeFocus: string
}

/** Label candidates drawn per frame, nearest the viewport centre first. */
const LABEL_CAP = 200
/** Quadtree rebuild throttle while the simulation is still warm. */
const QT_REBUILD_MS = 150

export function paletteFrom(
  mode: 'light' | 'dark',
  p: {
    primary: { main: string; light: string; dark: string; contrastText: string }
    secondary: { main: string }
    background: { paper: string }
    text: { primary: string }
    surfaceVariant: string
  },
): GraphPalette {
  void mode
  return {
    hub: p.secondary.main,
    hubLabel: p.primary.contrastText,
    collection: p.primary.main,
    syncRing: p.background.paper,
    image: p.surfaceVariant,
    imageStroke: p.secondary.main,
    imageShared: p.primary.light,
    imageSharedStroke: p.primary.dark,
    category: p.secondary.main,
    categoryFill: p.background.paper,
    selectionRing: p.text.primary,
    label: alpha(p.text.primary, 0.85),
    edgeNormal: alpha(p.text.primary, 0.25),
    edgeDim: alpha(p.text.primary, 0.06),
    edgeImgNormal: alpha(p.text.primary, 0.12),
    edgeImgDim: alpha(p.text.primary, 0.05),
    edgeFocus: alpha(p.primary.dark, 0.85),
  }
}

/**
 * Neighbourhood used for hover dimming: the node plus its direct
 * neighbours; for collections also the second hop through image nodes so
 * bridged collections light up (prototype `adjSet`).
 */
export function adjacency(model: GraphModel, focus: GraphNode): Set<GraphNode> {
  const s = new Set<GraphNode>([focus])
  for (const e of model.edges) {
    const sa = model.nodes[e.source]
    const ta = model.nodes[e.target]
    if (sa === focus) s.add(ta)
    if (ta === focus) s.add(sa)
  }
  if (focus.kind === 'collection') {
    for (const e of model.edges) {
      const sa = model.nodes[e.source]
      const ta = model.nodes[e.target]
      if (s.has(sa) && sa.kind === 'image') s.add(ta)
      if (s.has(ta) && ta.kind === 'image') s.add(sa)
    }
  }
  return s
}

/**
 * Canvas 2D renderer for a `GraphModel` — ports the prototype's `draw`
 * faithfully (#1629): one `setTransform(dpr·k, …)` per frame, edges and
 * nodes batched by style into single paths, viewport culling, screen-space
 * labels with per-frame overlap-skipping and a cap, and a lazily rebuilt
 * hit-test quadtree (≤ every 150 ms while warm, immediately once cooled).
 */
export class GraphRenderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private model: GraphModel
  private palette: GraphPalette
  private qt: Quadtree<GraphNode> | null = null
  private qtDirty = true
  private lastQt = 0
  private drawQueued = false
  private warm = false

  constructor(canvas: HTMLCanvasElement, model: GraphModel, palette: GraphPalette) {
    this.canvas = canvas
    this.model = model
    this.palette = palette
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
  }

  setModel(model: GraphModel): void {
    this.model = model
    this.qt = null
    this.qtDirty = true
  }

  setPalette(palette: GraphPalette): void {
    this.palette = palette
  }

  /** The simulation is still moving — the quadtree throttles its rebuilds. */
  setWarm(warm: boolean): void {
    this.warm = warm
    if (!warm) this.qtDirty = true
  }

  markDirty(): void {
    this.qtDirty = true
  }

  /** Resize the backing store to the CSS box × devicePixelRatio. */
  resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
  }

  /** Coalesce every caller's draw into one paint per animation frame. */
  requestDraw(state: DrawState): void {
    if (this.drawQueued) return
    this.drawQueued = true
    requestAnimationFrame(() => {
      this.drawQueued = false
      this.draw(state)
    })
  }

  /** Hit-test the node nearest `px,py` (container px), within the tap radius. */
  findNode(px: number, py: number, transform: ZoomTransform): GraphNode | null {
    if (this.qtDirty && (performance.now() - this.lastQt > QT_REBUILD_MS || !this.warm)) {
      this.qt = quadtree<GraphNode>()
        .x((d) => d.x)
        .y((d) => d.y)
        // "Shared only" nodes are excluded from hit testing (#1627).
        .addAll(this.model.nodes.filter((n) => !n.hidden))
      this.qtDirty = false
      this.lastQt = performance.now()
    }
    if (!this.qt) return null
    const p = transform.invert([px, py])
    return this.qt.find(p[0], p[1], 30 / Math.sqrt(transform.k)) ?? null
  }

  draw(state: DrawState): void {
    const { ctx, model, palette } = this
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (model.nodes.length === 0) return

    const t = state.transform
    const k = t.k
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * t.x, dpr * t.y)

    const focus = state.hover ?? state.selected
    const focusAdj = focus ? adjacency(model, focus) : null
    const dim = (n: GraphNode) => (focusAdj !== null ? !focusAdj.has(n) : state.searchDim.has(n))
    const hid = (n: GraphNode) => n.hidden === true
    const circ = (n: GraphNode) => {
      ctx.moveTo(n.x + n.r / Math.sqrt(k), n.y)
      ctx.arc(n.x, n.y, n.r / Math.sqrt(k), 0, 7)
    }

    // ---- edges, batched by style; viewport-culled (graph coords) ----
    const vx0 = -t.x / k - 40
    const vy0 = -t.y / k - 40
    const vx1 = (w - t.x) / k + 40
    const vy1 = (h - t.y) / k + 40
    const inV = (x: number, y: number, r: number) =>
      x + r >= vx0 && x - r <= vx1 && y + r >= vy0 && y - r <= vy1
    const batch = (list: GraphEdge[], style: string, lw: number) => {
      if (!list.length) return
      ctx.strokeStyle = style
      ctx.lineWidth = lw
      ctx.beginPath()
      for (const e of list) {
        ctx.moveTo(model.nodes[e.source].x, model.nodes[e.source].y)
        ctx.lineTo(model.nodes[e.target].x, model.nodes[e.target].y)
      }
      ctx.stroke()
    }
    const hN: GraphEdge[] = []
    const hD: GraphEdge[] = []
    const hF: GraphEdge[] = []
    const iN: GraphEdge[] = []
    const iD: GraphEdge[] = []
    const iF: GraphEdge[] = []
    for (const e of model.edges) {
      const sa = model.nodes[e.source]
      const ta = model.nodes[e.target]
      if (e.kind !== 'hub' && (hid(sa) || hid(ta))) continue
      if (
        Math.max(sa.x, ta.x) < vx0 ||
        Math.min(sa.x, ta.x) > vx1 ||
        Math.max(sa.y, ta.y) < vy0 ||
        Math.min(sa.y, ta.y) > vy1
      )
        continue
      const f = focus && (sa === focus || ta === focus)
      const thin = e.kind !== 'hub'
      ;(thin ? (f ? iF : focus ? iD : iN) : f ? hF : focus ? hD : hN).push(e)
    }
    batch(iD, palette.edgeImgDim, 0.6 / k)
    batch(iN, palette.edgeImgNormal, 0.6 / k)
    batch(hD, palette.edgeDim, 1 / k)
    batch(hN, palette.edgeNormal, 1 / k)
    batch(iF, alpha(palette.edgeFocus, 0.94), 1.2 / k)
    batch(hF, palette.edgeFocus, 1.4 / k)

    // ---- image nodes: plain then shared, each dim/normal batched ----
    ctx.fillStyle = palette.image
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && !n.shared && !hid(n) && inV(n.x, n.y, n.r) && dim(n)) circ(n)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && !n.shared && !hid(n) && inV(n.x, n.y, n.r) && !dim(n)) circ(n)
    ctx.fill()
    if (k >= 1.5) {
      ctx.strokeStyle = palette.imageStroke
      ctx.lineWidth = 0.5 / k
      ctx.beginPath()
      for (const n of model.nodes)
        if (n.kind === 'image' && !n.shared && !hid(n) && inV(n.x, n.y, n.r)) circ(n)
      ctx.stroke()
    }
    ctx.fillStyle = palette.imageShared
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && n.shared && !hid(n) && inV(n.x, n.y, n.r) && dim(n)) circ(n)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && n.shared && !hid(n) && inV(n.x, n.y, n.r) && !dim(n)) circ(n)
    ctx.fill()
    ctx.strokeStyle = palette.imageSharedStroke
    ctx.lineWidth = 0.8 / k
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && n.shared && !hid(n) && inV(n.x, n.y, n.r)) circ(n)
    ctx.stroke()

    // ---- collection nodes ----
    ctx.fillStyle = palette.collection
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'collection' && inV(n.x, n.y, n.r) && dim(n)) circ(n)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'collection' && inV(n.x, n.y, n.r) && !dim(n)) circ(n)
    ctx.fill()
    // synchronized = inner ring
    ctx.strokeStyle = palette.syncRing
    ctx.lineWidth = 1.6 / k
    ctx.beginPath()
    for (const n of model.nodes)
      if (
        n.kind === 'collection' &&
        n.collection?.type === 'synchronized' &&
        inV(n.x, n.y, n.r) &&
        !dim(n)
      ) {
        const rr = (n.r / Math.sqrt(k)) * 0.55
        ctx.moveTo(n.x + rr, n.y)
        ctx.arc(n.x, n.y, rr, 0, 7)
      }
    ctx.stroke()

    // ---- category nodes: hollow secondary-stroke discs ----
    ctx.fillStyle = palette.categoryFill
    ctx.strokeStyle = palette.category
    ctx.lineWidth = 1.5 / k
    for (const n of model.nodes) {
      if (n.kind !== 'category' || !inV(n.x, n.y, n.r)) continue
      ctx.globalAlpha = dim(n) ? 0.15 : 1
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r / Math.sqrt(k), 0, 7)
      ctx.fill()
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // ---- hub + selection ring ----
    for (const n of model.nodes) {
      if (!inV(n.x, n.y, n.r)) continue
      if (n.kind === 'hub') {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r / Math.sqrt(k), 0, 7)
        ctx.fillStyle = palette.hub
        ctx.fill()
      } else if (n.kind === 'collection' && state.selectedId === n.id) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r / Math.sqrt(k) + 4 / k, 0, 7)
        ctx.strokeStyle = palette.selectionRing
        ctx.lineWidth = 1.5 / k
        ctx.stroke()
      }
    }

    // ---- labels in screen space: constant px, overlap-skip, cap ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const drawn: { x: number; y: number; w: number; h: number }[] = []
    const cands: {
      n: GraphNode
      lbl: string
      sx: number
      sy: number
      sr: number
      font: string
      d: number
    }[] = []
    const ccx = w / 2
    const ccy = h / 2
    for (const n of model.nodes) {
      if (n.kind === 'hub') continue
      if (dim(n) || hid(n)) continue
      const sx = t.applyX(n.x)
      const sy = t.applyY(n.y)
      const sr = n.r * Math.sqrt(k)
      if (sx < -60 || sx > w + 60 || sy < -20 || sy > h + 20) continue
      let show: boolean
      let font = '11px Roboto,Arial'
      if (n.kind === 'collection') {
        show =
          k > 1.2 ||
          n === state.hover ||
          n.id === state.selectedId ||
          sr >= 12 ||
          (state.searchActive && state.searchMatch.has(n))
      } else if (n.kind === 'image') {
        font = '10px Roboto,Arial'
        show = k > 2.5 || n === state.hover
      } else {
        // category labels appear a little earlier — they are sparse
        show = k > 1 || n === state.hover
      }
      if (show) {
        cands.push({
          n,
          lbl: n.label,
          sx,
          sy,
          sr,
          font,
          d: (sx - ccx) * (sx - ccx) + (sy - ccy) * (sy - ccy),
        })
      }
    }
    if (cands.length > LABEL_CAP) {
      cands.sort((a, b) => a.d - b.d)
      cands.length = LABEL_CAP
    }
    for (const c of cands) {
      const lbl = c.lbl.length > 34 ? c.lbl.slice(0, 33) + '…' : c.lbl
      ctx.font = c.font
      const tw = ctx.measureText(lbl).width
      const rect = { x: c.sx + c.sr + 3, y: c.sy - 9, w: tw, h: 12 }
      if (
        drawn.some(
          (R) =>
            rect.x < R.x + R.w + 3 &&
            rect.x + rect.w + 3 > R.x &&
            rect.y < R.y + R.h &&
            rect.y + rect.h > R.y,
        )
      )
        continue
      drawn.push(rect)
      ctx.fillStyle = palette.label
      ctx.fillText(lbl, rect.x, c.sy + 4)
    }

    // hub label last, centred inside the hub
    const hub = model.nodes[0]
    if (hub?.kind === 'hub') {
      const sx = t.applyX(hub.x)
      const sy = t.applyY(hub.y)
      const sr = hub.r * Math.sqrt(k)
      ctx.textAlign = 'center'
      ctx.font = '500 12px Roboto,Arial'
      ctx.fillStyle = palette.hubLabel
      ctx.fillText(fitText(ctx, hub.label, 2 * sr - 6), sx, sy + 4)
      ctx.textAlign = 'left'
    }
  }
}

export interface DrawState {
  transform: ZoomTransform
  hover: GraphNode | null
  /** Focused/selected node driving the neighbourhood dim. */
  selected: GraphNode | null
  selectedId: number | null
  /** Non-empty when a search is active; holds the dimmed nodes. */
  searchDim: ReadonlySet<GraphNode>
  /** Collections matching the active search (label priority boost). */
  searchMatch: ReadonlySet<GraphNode>
  searchActive: boolean
}

function fitText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}
