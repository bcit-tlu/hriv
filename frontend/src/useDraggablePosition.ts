import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

export interface DragPosition {
  x: number
  y: number
}

/**
 * Per-session store for dragged positions, keyed by consumer-supplied id.
 * Survives unmount/remount (e.g. edit-mode toggles, image navigation) but
 * resets on full page reload.
 */
const sessionPositions = new Map<string, DragPosition>()

/** Clear all cached positions — intended for tests. */
export function clearDraggablePositionCache() {
  sessionPositions.clear()
}

const NUDGE_STEP = 8
const NUDGE_STEP_LARGE = 32

export interface UseDraggablePositionOptions {
  /** Persist the position for the app session under this key. */
  cacheKey?: string
  /** Called when a pointer drag starts — e.g. to close open menus. */
  onDragStart?: () => void
}

export interface DragHandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  onDoubleClick: () => void
}

export interface UseDraggablePositionResult {
  /** Attach to the absolutely-positioned element being moved. */
  targetRef: RefObject<HTMLElement | null>
  /** Current position in px relative to the offset parent, or null for default. */
  position: DragPosition | null
  dragging: boolean
  /** Spread onto the drag-handle element. */
  handleProps: DragHandleProps
  /** Re-clamp the stored position against the current container bounds. */
  reclamp: () => void
  /** Return to the default position. */
  reset: () => void
}

/**
 * Free-drag positioning for an absolutely-positioned element inside its
 * offset parent. `null` position means "render at the caller's default spot";
 * once dragged the caller switches to px `left/top` and drops any centering
 * transform. The whole element is clamped inside the parent bounds.
 */
export function useDraggablePosition(
  options: UseDraggablePositionOptions = {},
): UseDraggablePositionResult {
  const { cacheKey, onDragStart } = options
  const targetRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState<DragPosition | null>(() =>
    cacheKey ? (sessionPositions.get(cacheKey) ?? null) : null,
  )
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    baseX: number
    baseY: number
  } | null>(null)

  const getContext = useCallback(() => {
    const el = targetRef.current
    if (!el) return null
    const parent = (el.offsetParent as HTMLElement | null) ?? el.parentElement
    if (!parent) return null
    return { el, parent }
  }, [])

  /** Clamp a px position so the whole element stays inside the parent. */
  const clampToBounds = useCallback(
    (x: number, y: number): DragPosition => {
      const ctx = getContext()
      if (!ctx) return { x, y }
      // A zero-size parent means layout has not happened (e.g. jsdom); do not
      // collapse the stored position.
      if (ctx.parent.clientWidth === 0 || ctx.parent.clientHeight === 0) return { x, y }
      const maxX = Math.max(0, ctx.parent.clientWidth - ctx.el.offsetWidth)
      const maxY = Math.max(0, ctx.parent.clientHeight - ctx.el.offsetHeight)
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
      }
    },
    [getContext],
  )

  /** Measure the element's current rendered px position (transforms resolved). */
  const measure = useCallback((): DragPosition | null => {
    const ctx = getContext()
    if (!ctx) return null
    const rect = ctx.el.getBoundingClientRect()
    const parentRect = ctx.parent.getBoundingClientRect()
    return { x: rect.left - parentRect.left, y: rect.top - parentRect.top }
  }, [getContext])

  const commit = useCallback(
    (pos: DragPosition | null) => {
      setPosition(pos)
      if (cacheKey) {
        if (pos) sessionPositions.set(cacheKey, pos)
        else sessionPositions.delete(cacheKey)
      }
    },
    [cacheKey],
  )

  const reclamp = useCallback(() => {
    setPosition((pos) => {
      if (!pos) return pos
      const next = clampToBounds(pos.x, pos.y)
      if (next.x === pos.x && next.y === pos.y) return pos
      if (cacheKey) sessionPositions.set(cacheKey, next)
      return next
    })
  }, [clampToBounds, cacheKey])

  const reset = useCallback(() => commit(null), [commit])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || dragRef.current) return
      const base = position ?? measure()
      if (!base) return
      onDragStart?.()
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        baseX: base.x,
        baseY: base.y,
      }
      setDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
      e.preventDefault()
      // preventDefault suppresses the compat mousedown that would focus the
      // handle — focus it explicitly so arrow-key nudging works after a press.
      e.currentTarget.focus()
    },
    [position, measure, onDragStart],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const next = clampToBounds(
        drag.baseX + e.clientX - drag.startClientX,
        drag.baseY + e.clientY - drag.startClientY,
      )
      commit(next)
    },
    [clampToBounds, commit],
  )

  const endDrag = useCallback((e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Home') {
        e.preventDefault()
        e.stopPropagation()
        commit(null)
        return
      }
      const dirs: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const dir = dirs[e.key]
      if (!dir) return
      e.preventDefault()
      e.stopPropagation()
      const base = position ?? measure()
      if (!base) return
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
      commit(clampToBounds(base.x + dir[0] * step, base.y + dir[1] * step))
    },
    [position, measure, clampToBounds, commit],
  )

  // Clamp a restored position against current bounds on mount (the cached
  // position may come from a differently-sized container, e.g. full-page).
  // Deferred to rAF so layout has settled before measuring.
  useEffect(() => {
    const raf = requestAnimationFrame(reclamp)
    return () => cancelAnimationFrame(raf)
  }, [reclamp])

  // Re-clamp when the container may have resized (window resize etc.).
  useEffect(() => {
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [reclamp])

  return {
    targetRef,
    position,
    dragging,
    reclamp,
    reset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick: reset,
    },
  }
}
