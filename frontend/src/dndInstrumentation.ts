import { useMemo, useRef } from 'react'
import { useDragDropMonitor } from '@dnd-kit/react'
import type {
  CollisionEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/react'

/**
 * Enable DnD tracing by setting `localStorage.setItem('hriv-dnd-trace', '1')`
 * and reloading, or run a dev build where it is on by default.
 */
export function isDndTraceEnabled(envDev = import.meta.env.DEV): boolean {
  return (
    Boolean(envDev) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('hriv-dnd-trace') === '1')
  )
}

export function logDrag(label: string, payload?: Record<string, unknown>): void {
  if (!isDndTraceEnabled()) return
  const ts = performance.now().toFixed(1)
  console.debug(`[dnd ${ts}] ${label}`, payload ?? {})
}

// ── Render / refresh counters (issue #1100) ─────────────────────────────
// Dev-mode observability for the mid-drag rebuild gating and the browse-tree
// 304 short-circuit. Tile renders are counted only while a drag is active
// (the flag is set by the dragstart handler, which exists only when tracing
// is enabled), then summarized on dragend — memoized tiles should show ~zero
// re-renders during a drag (see frontend/tests/components/tileMemoization.test.tsx).
const tileRenderCounts = new Map<string, number>()
let tileRenderTracking = false

/** Increment the per-drag render count for one tile. Called by `GridTile`. */
export function recordTileRender(id: string): void {
  if (!tileRenderTracking) return
  tileRenderCounts.set(id, (tileRenderCounts.get(id) ?? 0) + 1)
}

function resetTileRenderCounts(): void {
  tileRenderCounts.clear()
  tileRenderTracking = true
}

function summarizeTileRenderCounts(): void {
  if (tileRenderCounts.size > 0) {
    let total = 0
    for (const count of tileRenderCounts.values()) total += count
    logDrag('render summary', {
      tileRenders: total,
      distinctTiles: tileRenderCounts.size,
    })
  }
  tileRenderCounts.clear()
  tileRenderTracking = false
}

/**
 * Session-level outcomes for `GET /api/categories/tree` refreshes — the
 * client-side view of the work the 304 short-circuit saves. `not_modified`
 * means the response was a 304 and no React state was rebuilt; `applied`
 * means a 200 payload actually changed the committed tree; `unchanged`
 * means a 200 payload was referentially identical to committed state.
 */
export const browseTreeStats = {
  polls: 0,
  not_modified: 0,
  applied: 0,
  unchanged: 0,
}
export type BrowseTreePollOutcome = 'not_modified' | 'applied' | 'unchanged'

export function recordBrowseTreePoll(outcome: BrowseTreePollOutcome): void {
  browseTreeStats.polls += 1
  browseTreeStats[outcome] += 1
  logDrag('browse-tree poll', { outcome, ...browseTreeStats })
}

// Console-readable handle for the feel-test operator (and ad-hoc debugging):
// `window.__hrivBrowseStats` in the browser console prints cumulative counts.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__hrivBrowseStats = browseTreeStats
}

const THROTTLE_MS = 150

/**
 * Non-rendering monitor that logs the dnd-kit drag pipeline for the Browse tab.
 * Place this component (or call the hook) inside the `DragDropProvider` whose
 * events you want to trace.
 */
export function DndMonitor(): null {
  const enabled = isDndTraceEnabled()
  useDnDMonitor(enabled)
  return null
}

export function useDnDMonitor(enabled: boolean = isDndTraceEnabled()): void {
  const lastMoveLogRef = useRef(0)
  const lastCollisionLogRef = useRef(0)

  const handlers = useMemo(() => {
    if (!enabled) {
      return {}
    }

    return {
      onDragStart: (event: DragStartEvent) => {
        lastMoveLogRef.current = 0
        lastCollisionLogRef.current = 0
        resetTileRenderCounts()

        const { operation } = event
        logDrag('dragstart', {
          source: operation.source?.id,
          position: operation.position.current,
        })
      },
      onDragMove: (event: DragMoveEvent) => {
        const now = performance.now()
        if (now - lastMoveLogRef.current < THROTTLE_MS) return
        lastMoveLogRef.current = now

        const { operation } = event
        logDrag('dragmove', {
          source: operation.source?.id,
          position: operation.position.current,
          delta: operation.position.delta,
          by: event.by,
        })
      },
      onDragOver: (event: DragOverEvent) => {
        const { operation } = event
        logDrag('dragover', {
          source: operation.source?.id,
          target: operation.target?.id,
          position: operation.position.current,
        })
      },
      onCollision: (event: CollisionEvent) => {
        const now = performance.now()
        if (now - lastCollisionLogRef.current < THROTTLE_MS) return
        lastCollisionLogRef.current = now

        const collisions = event.collisions.map((c) => ({
          id: c.id,
          priority: c.priority,
          value: typeof c.value === 'number' ? Number(c.value.toFixed(4)) : c.value,
        }))
        logDrag('collision', { collisions })
      },
      onDragEnd: (event: DragEndEvent) => {
        const { operation } = event
        logDrag('dragend', {
          source: operation.source?.id,
          target: operation.target?.id,
          canceled: event.canceled,
          position: operation.position.current,
        })
        summarizeTileRenderCounts()
      },
    }
  }, [enabled])

  useDragDropMonitor(handlers)
}
