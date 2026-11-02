/**
 * Non-interactive canvas layer that draws count outlines on the OSD viewer
 * (epic #1661, #1668). Appended to `viewer.canvas` with
 * `pointer-events: none` — never part of annotations, never saved.
 *
 * Redraws at most once per animation frame on OSD viewport events. The
 * drawing itself lives in `../countOutlines` (unit-tested there).
 */

import { useEffect, useRef } from 'react'
import type OpenSeadragon from 'openseadragon'

import { drawCountOutlines, type CountOutlinesSelection } from '../countOutlines'

export default function CountOutlinesLayer({
  viewer,
  items,
}: {
  viewer: OpenSeadragon.Viewer
  items: CountOutlinesSelection[]
}) {
  const itemsRef = useRef(items)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '12'
    canvas.setAttribute('aria-hidden', 'true')
    canvasRef.current = canvas
    viewer.canvas.appendChild(canvas)

    const redraw = () => {
      const dpr = window.devicePixelRatio || 1
      const cw = viewer.canvas.clientWidth
      const ch = viewer.canvas.clientHeight
      if (canvas.width !== cw * dpr) canvas.width = cw * dpr
      if (canvas.height !== ch * dpr) canvas.height = ch * dpr
      canvas.style.width = `${cw}px`
      canvas.style.height = `${ch}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)
      drawCountOutlines(ctx, viewer, itemsRef.current)
    }
    let pending = false
    const schedule = () => {
      if (!pending) {
        pending = true
        rafRef.current = requestAnimationFrame(() => {
          pending = false
          redraw()
        })
      }
    }
    const events = [
      'animation',
      'animation-finish',
      'resize',
      'rotate',
      'flip',
      'viewport-change',
    ] as const
    for (const e of events) viewer.addHandler(e, schedule)
    schedule()
    return () => {
      for (const e of events) viewer.removeHandler(e, schedule)
      cancelAnimationFrame(rafRef.current)
      canvas.remove()
      canvasRef.current = null
    }
  }, [viewer])

  // Immediate redraw when items change (e.g. a job finished) — don't wait
  // for the next viewport event.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const cw = viewer.canvas.clientWidth
    const ch = viewer.canvas.clientHeight
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    drawCountOutlines(ctx, viewer, items)
  }, [items, viewer])

  return null
}
