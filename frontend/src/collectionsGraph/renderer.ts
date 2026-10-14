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
  collectionSync: string
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

/** App minimum text size (MUI caption, 0.75rem) — labels never shrink below it. */
const LABEL_MIN_PX = 12
/** Cap so fully zoomed-in (k=24) labels stay readable rather than huge. */
const LABEL_MAX_PX = 32
/** Base sizes at k=1; scale by √k like node radii. */
const LABEL_BASE_PX = { collection: 13, image: 12, category: 12, hub: 13 } as const
export function labelPx(base: number, k: number): number {
  return Math.max(LABEL_MIN_PX, Math.min(LABEL_MAX_PX, base * Math.sqrt(k)))
}

/** Zoom level (k) above which each node kind draws its label (#1630). */
export interface LabelThresholds {
  collection: number
  image: number
  category: number
}
const DEFAULT_LABEL_THRESHOLDS: LabelThresholds = { collection: 1.2, image: 2.5, category: 1 }
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
    collectionSync: p.primary.light,
    image: p.surfaceVariant,
    imageStroke: p.secondary.main,
    imageShared: p.surfaceVariant,
    imageSharedStroke: p.primary.main,
    category: p.secondary.main,
    categoryFill: p.background.paper,
    selectionRing: p.text.primary,
    label: alpha(p.text.primary, 0.85),
    edgeNormal: alpha(p.text.primary, 0.45),
    edgeDim: alpha(p.text.primary, 0.06),
    edgeImgNormal: alpha(p.text.primary, 0.35),
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
 * labels sized ∝ √k between 12px and 32px with per-frame overlap-skipping
 * and a cap, and a lazily rebuilt
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
  private labelThresholds: LabelThresholds = DEFAULT_LABEL_THRESHOLDS

  constructor(canvas: HTMLCanvasElement, model: GraphModel, palette: GraphPalette) {
    this.canvas = canvas
    this.model = model
    this.palette = palette
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
  }

  /**
   * Per-kind zoom level (k) at which labels start drawing (#1630 — the
   * collection dialog wants image labels earlier than the page graph).
   */
  setLabelThresholds(t: Partial<LabelThresholds>): void {
    this.labelThresholds = { ...this.labelThresholds, ...t }
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
    // Fixed 12 px screen-space tolerance. Nodes render at `r / sqrt(k)`
    // graph units, so a node's drawn radius in graph units is r/sqrt(k)
    // and the tap padding is 12/k — both shrink with zoom, so distant
    // clicks stop hitting at high k (#1636).
    const k = transform.k
    const tol = 12 / k
    const maxR = this.model.nodes.reduce((m, n) => Math.max(m, n.r), 0)
    const node = this.qt.find(p[0], p[1], maxR / Math.sqrt(k) + tol)
    if (!node) return null
    return Math.hypot(node.x - p[0], node.y - p[1]) <= node.r / Math.sqrt(k) + tol ? node : null
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
    ctx.lineWidth = 1.2 / k
    // dimmed shared images keep a faded outline to match their fill
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && n.shared && !hid(n) && inV(n.x, n.y, n.r) && dim(n)) circ(n)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (const n of model.nodes)
      if (n.kind === 'image' && n.shared && !hid(n) && inV(n.x, n.y, n.r) && !dim(n)) circ(n)
    ctx.stroke()

    // ---- collection nodes: synchronized fill differs from sequenced
    // (no ring — the fill itself is the type cue, #1656) ----
    const fillCollections = (sync: boolean, alpha_: number, dimmed: boolean) => {
      ctx.fillStyle = sync ? palette.collectionSync : palette.collection
      ctx.globalAlpha = alpha_
      ctx.beginPath()
      for (const n of model.nodes)
        if (
          n.kind === 'collection' &&
          (n.collection?.type === 'synchronized') === sync &&
          inV(n.x, n.y, n.r) &&
          dim(n) === dimmed
        )
          circ(n)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    fillCollections(false, 0.15, true)
    fillCollections(false, 1, false)
    fillCollections(true, 0.15, true)
    fillCollections(true, 1, false)

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

    // ---- labels in screen space: ∝ √k (12–32px), overlap-skip, cap ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const drawn: { x: number; y: number; w: number; h: number }[] = []
    const cands: {
      n: GraphNode
      lbl: string
      sx: number
      sy: number
      sr: number
      fs: number
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
      let base: number = LABEL_BASE_PX.collection
      const thr = this.labelThresholds
      if (n.kind === 'collection') {
        show =
          k > thr.collection ||
          n === state.hover ||
          n.id === state.selectedId ||
          sr >= 12 ||
          (state.searchActive && state.searchMatch.has(n))
      } else if (n.kind === 'image') {
        base = LABEL_BASE_PX.image
        show = k > thr.image || n === state.hover
      } else {
        base = LABEL_BASE_PX.category
        // category labels appear a little earlier — they are sparse
        show = k > thr.category || n === state.hover
      }
      if (show) {
        cands.push({
          n,
          // `labelFor` lets callers rewrite labels (the dialog strips the
          // hub collection's name prefix from image labels, #1630).
          lbl: state.labelFor?.(n) ?? n.label,
          sx,
          sy,
          sr,
          fs: labelPx(base, k),
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
      ctx.font = `${c.fs}px Roboto,Arial`
      const tw = ctx.measureText(lbl).width
      const rect = { x: c.sx + c.sr + 3, y: c.sy - c.fs * 0.75, w: tw, h: c.fs }
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
      ctx.fillText(lbl, rect.x, c.sy + c.fs / 3)
    }

    // hub label last: centred inside when it fits; otherwise to the
    // right like the other labels (a small dialog hub would truncate
    // to nothing, #1653)
    const hub = model.nodes[0]
    if (hub?.kind === 'hub') {
      const sx = t.applyX(hub.x)
      const sy = t.applyY(hub.y)
      const sr = hub.r * Math.sqrt(k)
      const hfs = labelPx(LABEL_BASE_PX.hub, k)
      ctx.font = `500 ${hfs}px Roboto,Arial`
      if (ctx.measureText(hub.label).width <= 2 * sr - 6) {
        ctx.textAlign = 'center'
        ctx.fillStyle = palette.hubLabel
        ctx.fillText(hub.label, sx, sy + hfs / 3)
        ctx.textAlign = 'left'
      } else {
        const lbl = hub.label.length > 34 ? hub.label.slice(0, 33) + '…' : hub.label
        const tw = ctx.measureText(lbl).width
        ctx.fillStyle = palette.label
        // Prefer the right like the other labels; flip left when only
        // that side has room (a long name near the right edge would clip)
        if (sx + sr + 3 + tw > w && sx - sr - 3 - tw >= 0) {
          ctx.textAlign = 'right'
          ctx.fillText(lbl, sx - sr - 3, sy + hfs / 3)
          ctx.textAlign = 'left'
        } else {
          ctx.fillText(lbl, sx + sr + 3, sy + hfs / 3)
        }
      }
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
  /** Optional label rewriter (e.g. hub-name prefix stripping, #1630). */
  labelFor?: (n: GraphNode) => string
}
