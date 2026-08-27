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
      },
    }
  }, [enabled])

  useDragDropMonitor(handlers)
}
