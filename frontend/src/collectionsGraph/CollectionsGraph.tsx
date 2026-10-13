import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Collapse from '@mui/material/Collapse'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { drag } from 'd3-drag'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { useColorMode } from '../useColorMode'
import { getThemePalette } from '../theme'
import { CollectionTypeChip } from '../components/CollectionCard'
import type { GraphModel, GraphNode } from './types'
import { GraphRenderer, paletteFrom, type DrawState, type LabelThresholds } from './renderer'
import { createGraphSimulation, preTick, startDragRepel, stopDragRepel } from './simulation'
import { graphSpineKey } from './buildModel'

/**
 * Info the tooltip needs that the graph payload does not carry (the graph
 * has no owner data) — supplied by the page from its collection list.
 */
export interface GraphTooltipInfo {
  /** Category breadcrumb text for a collection/category id, e.g. "A › B". */
  categoryLabel: (categoryId: number | null) => string
  /** Owner line for a collection id; undefined when unknown. */
  ownerLabel: (collectionId: number) => string | undefined
  /** Collection display name for a collection id (image tooltips). */
  collectionName: (collectionId: number) => string | undefined
}

export interface CollectionsGraphProps {
  model: GraphModel
  onOpenCollection: (id: number) => void
  /** Opens the image viewer for an image id (#1629). */
  onOpenImage?: (imageId: number) => void
  /** Active search text — matching collections stay lit, others dim. */
  searchQuery?: string
  /** Page-level matcher for the shared search filter. */
  matchesSearch?: (collectionId: number) => boolean
  /** Other client filters are narrowing the set even when the search text
   *  is empty (the Visibility facet) — dims non-matches the same way. */
  filterActive?: boolean
  tooltipInfo?: GraphTooltipInfo
  /** Show the collapsible legend overlay (default true). */
  legend?: boolean
  /** Extra controls rendered in the top-right overlay (order toggle, etc.). */
  overlay?: ReactNode
  /** Keep the running simulation after mount instead of letting it cool —
   *  stories use this off so Chromatic snapshots are deterministic. */
  simulate?: boolean
  /** Per-kind zoom levels at which labels appear (defaults: page tuning). */
  labelThresholds?: Partial<LabelThresholds>
  /** Rewrite a node's drawn label (dialog strips the hub-name prefix). */
  labelFor?: (n: GraphNode) => string
  /** Replace the computed stats caption (the dialog counts differ, #1630). */
  statsCaption?: string
  /** Refit the view after a model rebuild (order/node-set change). The page
   *  graph deliberately keeps the transform (#1636); the collection dialog
   *  passes this so an order change cannot leave the hub off-canvas. */
  fitOnRebuild?: boolean
  /** Legend wording: 'page' describes the collections hub; 'collection'
   *  (the dialog) names the hub "This collection" and defers
   *  related-collection rows to 2nd order. */
  legendVariant?: 'page' | 'collection'
}

interface TooltipState {
  node: GraphNode
  x: number
  y: number
}

/**
 * Canvas-2D hub-and-spoke graph for the Collections page (#1629). Ports
 * the prototype's physics and rendering verbatim (see `simulation.ts` /
 * `renderer.ts`): fit once after pre-ticks, reheat only on real drag
 * movement, pointer-space drag subject, zoom extent 0.1–24, rAF-coalesced
 * batched drawing, viewport culling, label cap, lazy quadtree, zoom
 * `.filter` yielding to drag over a node.
 *
 * State (positions, zoom) survives model rebuilds: `buildGraphModel`
 * carries positions for shared `(kind, id)` nodes and the transform lives
 * in `transformRef` for the mount — the view refits only on the first
 * build, never on rebuilds (Shared only, order changes, refreshes).
 */
export default function CollectionsGraph({
  model,
  onOpenCollection,
  onOpenImage,
  searchQuery = '',
  matchesSearch,
  filterActive = false,
  tooltipInfo,
  legend = true,
  overlay,
  simulate = true,
  labelThresholds,
  labelFor,
  statsCaption,
  fitOnRebuild = false,
  legendVariant = 'page',
}: CollectionsGraphProps) {
  const { mode } = useColorMode()
  const palette = useMemo(() => paletteFrom(mode, getThemePalette(mode)), [mode])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  // Canvas wrapper — the ResizeObserver and tooltip clamp measure the
  // drawing area, not the outer frame (the toolbar row sits above it).
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<GraphRenderer | null>(null)
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const transformRef = useRef<ZoomTransform | null>(null)
  const prevModelRef = useRef<GraphModel | null>(null)
  const fitCountRef = useRef(0)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const hoverRef = useRef<GraphNode | null>(null)

  // search dimming: non-matching collections dim in the graph (#1629);
  // nothing is removed from the model.
  const searchActive = searchQuery.trim().length > 0 || filterActive
  const searchSets = useMemo(() => {
    const dim = new Set<GraphNode>()
    const match = new Set<GraphNode>()
    if (searchActive && matchesSearch) {
      for (const n of model.nodes) {
        if (n.kind !== 'collection') continue
        if (matchesSearch(n.id)) match.add(n)
        else dim.add(n)
      }
    }
    return { dim, match }
  }, [model, searchActive, matchesSearch])

  const drawState = useCallback(
    (transform: ZoomTransform): DrawState => ({
      transform,
      hover: hoverRef.current,
      selected: selectedId != null ? findById(model, selectedId) : null,
      selectedId,
      searchDim: searchSets.dim,
      searchMatch: searchSets.match,
      searchActive,
      labelFor,
    }),
    [model, searchSets, searchActive, selectedId, labelFor],
  )

  // Build/attach the simulation + renderer once per model identity.
  // Positions already on `model.nodes` mean a remount (view switch,
  // collection round-trip) keeps the settled layout — only a new model
  // (order or node set change) rebuilds.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const existing = rendererRef.current
    const rendererNow =
      existing != null && rendererModel(existing) === model
        ? existing
        : new GraphRenderer(canvas, model, palette)
    if (rendererNow !== existing) {
      rendererRef.current = rendererNow
      ;(rendererNow as unknown as { __model?: GraphModel }).__model = model
    }
    if (labelThresholds) rendererNow.setLabelThresholds(labelThresholds)
    const dragTarget = (mx: number, my: number): GraphNode | null =>
      rendererNow.findNode(mx, my, transformRef.current ?? zoomIdentity)

    // zoom yields to drag over a node: d3-zoom stops mousedown propagation
    const zb = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 24])
      .filter((e: Event) => {
        const me = e as MouseEvent
        return (
          (!me.ctrlKey || e.type === 'wheel') &&
          !me.button &&
          !(e.type === 'mousedown' && dragTarget(me.offsetX, me.offsetY) != null)
        )
      })
      .on('zoom', (e: { transform: ZoomTransform }) => {
        transformRef.current = e.transform
        rendererNow.requestDraw(drawState(e.transform))
      })
    zoomRef.current = zb
    const sel = select(canvas)
    sel.call(zb).on('dblclick.zoom', null)

    const gs = createGraphSimulation(
      model,
      () => {
        rendererNow.markDirty()
        rendererNow.setWarm(true)
        const t = transformRef.current
        if (t) rendererNow.requestDraw(drawState(t))
      },
      () => {
        rendererNow.setWarm(false)
        rendererNow.markDirty()
      },
    )

    rendererNow.resize()
    const prevModel = prevModelRef.current
    prevModelRef.current = model
    const currentTransform = transformRef.current
    if (currentTransform == null) {
      // First build of the mount: pre-tick then fit ONCE — no autofit on
      // cool/resize/rebuild (epic #1627, #1636 review).
      preTick(gs.sim)
      fitView(canvas, zb, transformRef, model)
      fitCountRef.current += 1
      frameRef.current?.setAttribute('data-fit-count', String(fitCountRef.current))
    } else {
      // Rebuild (order / Shared only / refresh): `buildGraphModel` already
      // carried positions for shared (kind, id) nodes, and the transform
      // persists — only re-settle when the collection spine changed.
      if (prevModel == null || graphSpineKey(prevModel) !== graphSpineKey(model)) {
        preTick(gs.sim)
      }
      if (fitOnRebuild) {
        // Dialog callers opt in: a rebuilt layout can drift the kept
        // transform off-canvas, so refit (animated like the Fit button)
        // and count it for tests.
        fitView(canvas, zb, transformRef, model, false)
        fitCountRef.current += 1
        frameRef.current?.setAttribute('data-fit-count', String(fitCountRef.current))
      } else {
        applyTransform(canvas, zb, currentTransform)
      }
    }
    if (!simulate) gs.sim.stop()

    rendererNow.requestDraw(drawState(transformRef.current ?? zoomIdentity))

    // subject carries container-space x/y so the node does not jump at k≠1;
    // the sim reheats only once the pointer actually moved (>1px).
    let dragMoved = false
    let dragStart: [number, number] | null = null
    type DragSubject = { node: GraphNode; x: number; y: number } | null
    const dragBehavior = drag<HTMLCanvasElement, unknown, DragSubject>()
      .subject((e) => {
        const n = dragTarget(e.x, e.y)
        const t = transformRef.current ?? zoomIdentity
        return n ? { node: n, x: t.applyX(n.x), y: t.applyY(n.y) } : null
      })
      .on('start', (e) => {
        if (!e.subject) return
        dragMoved = false
        dragStart = [e.x, e.y]
        setTooltip(null)
      })
      .on('drag', (e) => {
        const n = e.subject?.node
        if (!n || !dragStart) return
        if (!dragMoved && Math.hypot(e.x - dragStart[0], e.y - dragStart[1]) > 1) {
          dragMoved = true
          startDragRepel(gs, n)
        }
        const t = transformRef.current ?? zoomIdentity
        const p = t.invert([e.x, e.y])
        n.x = p[0]
        n.y = p[1]
        n.fx = p[0]
        n.fy = p[1]
        rendererNow.requestDraw(drawState(t))
      })
      .on('end', (e) => {
        const n = e.subject?.node
        if (n) {
          n.fx = null
          n.fy = null
        }
        if (dragMoved) stopDragRepel(gs)
      })
    sel.call(dragBehavior)

    const onMove = (e: MouseEvent) => {
      if (e.buttons) return
      const nd = rendererNow.findNode(e.offsetX, e.offsetY, transformRef.current ?? zoomIdentity)
      if (nd !== hoverRef.current) {
        hoverRef.current = nd
        canvas.style.cursor = nd ? (nd.kind === 'hub' ? 'grab' : 'pointer') : 'grab'
        const t = transformRef.current ?? zoomIdentity
        rendererNow.requestDraw(drawState(t))
      }
      if (!nd || nd.kind === 'hub') {
        setTooltip(null)
      } else {
        const fw = canvasWrapRef.current?.clientWidth ?? 0
        const fh = canvasWrapRef.current?.clientHeight ?? 0
        setTooltip({
          node: nd,
          x: clampTooltip(e.offsetX + 14, fw - 292),
          y: clampTooltip(e.offsetY + 10, fh - 180),
        })
      }
    }
    const onLeave = () => {
      hoverRef.current = null
      setTooltip(null)
      const t = transformRef.current ?? zoomIdentity
      rendererNow.requestDraw(drawState(t))
    }
    const onClick = (e: MouseEvent) => {
      const nd = rendererNow.findNode(e.offsetX, e.offsetY, transformRef.current ?? zoomIdentity)
      if (!nd || nd.kind === 'hub') return
      if (nd.kind === 'collection') {
        setSelectedId(nd.id)
        onOpenCollection(nd.id)
      } else if (nd.kind === 'image' && onOpenImage) {
        onOpenImage(nd.id)
      }
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('click', onClick)

    return () => {
      gs.sim.stop()
      stopDragRepel(gs)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('click', onClick)
      sel.on('.zoom', null)
      sel.on('.drag', null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // Palette change (light/dark) → recolour only.
  useEffect(() => {
    rendererRef.current?.setPalette(palette)
    const t = transformRef.current
    if (t) rendererRef.current?.requestDraw(drawState(t))
  }, [palette, drawState])

  // Label tuning (per-kind zoom thresholds, #1630) → redraw.
  useEffect(() => {
    if (labelThresholds) rendererRef.current?.setLabelThresholds(labelThresholds)
    const t = transformRef.current
    if (t) rendererRef.current?.requestDraw(drawState(t))
  }, [labelThresholds, drawState])

  // Search/hover/selection change → redraw.
  useEffect(() => {
    const t = transformRef.current
    if (t) rendererRef.current?.requestDraw(drawState(t))
  }, [searchSets, searchActive, drawState, selectedId])

  // ResizeObserver resizes + redraws — never refits (#1627).
  useEffect(() => {
    const wrap = canvasWrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      rendererRef.current?.resize()
      const t = transformRef.current
      if (t) rendererRef.current?.requestDraw(drawState(t))
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [drawState])

  const fit = () => {
    const canvas = canvasRef.current
    if (!canvas || !zoomRef.current) return
    fitView(canvas, zoomRef.current, transformRef, model, false)
  }

  // Empty only when nothing but the hub is drawable — isolated order-3
  // categories still render with zero collections (#1636 review).
  const empty = !model.nodes.some((n) => n.kind !== 'hub' && !n.hidden)
  const s = model.stats
  const statsLine =
    statsCaption ??
    `${s.collections} ${s.collections === 1 ? 'collection' : 'collections'}` +
      (s.order >= 2
        ? ` · ${s.images} ${s.images === 1 ? 'image' : 'images'} · ${s.shared} shared`
        : '') +
      (s.order >= 3
        ? ` · ${s.categories} ${s.categories === 1 ? 'category' : 'categories'}` +
          (s.unconnectedCategories > 0 ? ` (${s.unconnectedCategories} without a collection)` : '')
        : '')

  return (
    <Box
      ref={frameRef}
      data-testid="collections-graph"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        // Fill a flex-column parent (page graph, dialog body) at md+; a
        // zero flex basis on xs would collapse the fixed 420px fallback
        // down to the 320px minimum (#1630 feedback + review).
        flex: { md: '1 1 0' },
        height: { xs: 420, md: '100%' },
        minHeight: 320,
      }}
    >
      {/* Toolbar row above the canvas — the stats caption on the left and
          the page-supplied controls + Fit on the right. Nothing overlays
          the drawing area any more (#1627 feel-test feedback). */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 0.5,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" data-testid="graph-stats">
          {statsLine}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {overlay}
          <Button
            variant="outlined"
            size="small"
            startIcon={<FitScreenIcon />}
            onClick={fit}
            data-testid="graph-fit"
          >
            Fit graph
          </Button>
        </Box>
      </Box>

      <Box ref={canvasWrapRef} sx={{ position: 'relative', flex: '1 1 0', minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          data-testid="collections-graph-canvas"
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
        />

        {legend && !empty && (
          <Paper
            variant="outlined"
            data-testid="graph-legend"
            sx={{ position: 'absolute', left: 8, bottom: 8, px: 1, py: 0.5, maxWidth: 200 }}
          >
            <Box
              sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setLegendOpen((o) => !o)}
            >
              <Typography variant="caption" sx={{ fontWeight: 600, flexGrow: 1 }}>
                Legend
              </Typography>
              <IconButton
                size="small"
                aria-label={legendOpen ? 'Collapse legend' : 'Expand legend'}
              >
                {legendOpen ? (
                  <ExpandLessIcon fontSize="small" />
                ) : (
                  <ExpandMoreIcon fontSize="small" />
                )}
              </IconButton>
            </Box>
            <Collapse in={legendOpen}>
              <LegendRow
                swatch={<Swatch fill={palette.hub} />}
                label={
                  legendVariant === 'collection'
                    ? 'This collection (centre)'
                    : 'Collections hub (centre)'
                }
              />
              {(legendVariant === 'page' || model.stats.order >= 2) && (
                <LegendRow
                  swatch={<Swatch fill={palette.collection} />}
                  label={
                    legendVariant === 'collection'
                      ? 'Related collection — size reflects image count'
                      : 'Collection — size reflects image count'
                  }
                />
              )}
              {(legendVariant === 'page' || model.stats.order >= 2) && (
                <LegendRow
                  swatch={<Swatch fill={palette.collection} ring={palette.syncRing} />}
                  label="Synchronized collection"
                />
              )}
              {model.stats.order >= 2 && (
                <LegendRow swatch={<Swatch fill={palette.image} />} label="Image" />
              )}
              {model.stats.order >= 2 && (
                <LegendRow
                  swatch={<Swatch fill={palette.imageShared} stroke={palette.imageSharedStroke} />}
                  label="Shared image (in 2+ collections)"
                />
              )}
              {model.stats.order >= 3 && (
                <LegendRow
                  swatch={<Swatch fill={palette.categoryFill} stroke={palette.category} />}
                  label="Category"
                />
              )}
            </Collapse>
          </Paper>
        )}

        {empty && (
          <Box
            data-testid="collections-graph-empty"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <Typography variant="body2">No collections match the current filters.</Typography>
          </Box>
        )}

        {tooltip && (
          <Paper
            data-testid="graph-tooltip"
            elevation={4}
            sx={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y,
              px: 1.5,
              py: 1,
              maxWidth: 280,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <TooltipBody node={tooltip.node} model={model} info={tooltipInfo} order={s.order} />
          </Paper>
        )}
      </Box>
    </Box>
  )
}

function findById(model: GraphModel, id: number): GraphNode | null {
  return model.nodes.find((n) => n.kind === 'collection' && n.id === id) ?? null
}

function clampTooltip(pos: number, max: number): number {
  return Math.max(4, Math.min(pos, Math.max(4, max)))
}

function rendererModel(r: GraphRenderer): GraphModel | undefined {
  return (r as unknown as { __model?: GraphModel }).__model
}

function applyTransform(
  canvas: HTMLCanvasElement,
  zb: ZoomBehavior<HTMLCanvasElement, unknown>,
  t: ZoomTransform,
): void {
  select(canvas).call(zb.transform, t)
}

/** Fit the whole node set into the canvas — runs once per model build. */
function fitView(
  canvas: HTMLCanvasElement,
  zb: ZoomBehavior<HTMLCanvasElement, unknown>,
  transformRef: { current: ZoomTransform | null },
  model: GraphModel,
  instant = true,
): void {
  if (!model.nodes.length || !canvas.clientWidth) return
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const n of model.nodes) {
    if (n.hidden) continue
    x0 = Math.min(x0, n.x - n.r)
    x1 = Math.max(x1, n.x + n.r)
    y0 = Math.min(y0, n.y - n.r)
    y1 = Math.max(y1, n.y + n.r)
  }
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const k = Math.max(
    0.1,
    Math.min(24, Math.min(w / Math.max(1, x1 - x0 + 80), h / Math.max(1, y1 - y0 + 80))),
  )
  const nt = zoomIdentity
    .translate(w / 2, h / 2)
    .scale(k)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
  if (instant) select(canvas).call(zb.transform, nt)
  else
    select(canvas)
      .transition()
      .duration(400)
      .call(zb.transform, nt as never)
  transformRef.current = nt
}

function Swatch({ fill, stroke, ring }: { fill: string; stroke?: string; ring?: string }) {
  return (
    <Box
      sx={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        bgcolor: fill,
        border: stroke ? `1.5px solid ${stroke}` : ring ? `2px solid ${ring}` : 'none',
        boxShadow: ring ? `inset 0 0 0 1.5px ${ring}` : undefined,
        flexShrink: 0,
      }}
    />
  )
}

function LegendRow({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}>
      {swatch}
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}

/** Tooltip card content per node kind (#1629). */
function TooltipBody({
  node,
  model,
  info,
  order,
}: {
  node: GraphNode
  model: GraphModel
  info?: GraphTooltipInfo
  order: number
}) {
  if (node.kind === 'collection' && node.collection) {
    const shared = sharedInfoFor(model, node)
    const owner = info?.ownerLabel(node.id)
    return (
      <>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {node.collection.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <CollectionTypeChip type={node.collection.type} />
          <Typography variant="caption" color="text.secondary">
            {node.collection.image_count} {node.collection.image_count === 1 ? 'image' : 'images'}
          </Typography>
        </Box>
        {info?.categoryLabel(node.collection.category_id) ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {info.categoryLabel(node.collection.category_id)}
          </Typography>
        ) : null}
        {owner && (
          <Typography variant="caption" color="text.secondary" display="block">
            {owner}
          </Typography>
        )}
        {order >= 2 && shared.imgs > 0 && (
          <Typography variant="caption" color="text.secondary" display="block">
            shares {shared.imgs} {shared.imgs === 1 ? 'image' : 'images'} with {shared.colls}{' '}
            {shared.colls === 1 ? 'collection' : 'collections'}
          </Typography>
        )}
      </>
    )
  }
  if (node.kind === 'image' && node.image) {
    const names = (node.imageCollectionIds ?? [])
      .map((id) => info?.collectionName(id))
      .filter((n): n is string => Boolean(n))
    return (
      <>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {node.image.name}
        </Typography>
        {info?.categoryLabel(node.image.category_id) ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {info.categoryLabel(node.image.category_id)}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" display="block">
          in {(node.imageCollectionIds ?? []).length}{' '}
          {(node.imageCollectionIds ?? []).length === 1 ? 'collection' : 'collections'}
          {names.length ? `: ${names.slice(0, 5).join(', ')}` : ''}
          {names.length > 5 ? ' …' : ''}
        </Typography>
      </>
    )
  }
  if (node.kind === 'category' && node.category) {
    return (
      <>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {node.category.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {node.category.path}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {node.category.image_count} {node.category.image_count === 1 ? 'image' : 'images'}
        </Typography>
        {node.isolated && (
          <Chip size="small" variant="outlined" label="no collection yet" sx={{ mt: 0.5 }} />
        )}
      </>
    )
  }
  return null
}

/** "shares N images with M collections" for a collection tooltip. */
function sharedInfoFor(model: GraphModel, collNode: GraphNode): { imgs: number; colls: number } {
  let imgs = 0
  const others = new Set<number>()
  for (const n of model.nodes) {
    if (n.kind !== 'image' || !n.shared) continue
    const ids = n.imageCollectionIds ?? []
    if (!ids.includes(collNode.id)) continue
    imgs++
    for (const id of ids) if (id !== collNode.id) others.add(id)
  }
  return { imgs, colls: others.size }
}
