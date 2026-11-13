/**
 * Non-interactive canvas layer that draws the detection-preview outline
 * mask on the dialog's OSD viewer (#1872). Same lifecycle as
 * `CountOutlinesLayer`: appended to `viewer.canvas` with
 * `pointer-events: none`, redrawn at most once per animation frame on
 * viewport events. The drawing itself lives in `../detectionOutlines`.
 */

import { useEffect, useRef } from 'react'

import {
  drawDetectionOutline,
  type DetectionOverlay,
  type OutlineViewerSurface,
} from '../detectionOutlines'

/** The viewer surface the layer uses — the dialog's `DetectionViewer`
 * satisfies this only when the factory returns a real OSD instance. */
export interface OutlineViewer extends OutlineViewerSurface {
  canvas: OutlineViewerSurface['canvas'] & { appendChild(el: HTMLElement): void }
  addHandler(eventName: string, handler: () => void): void
  removeHandler(eventName: string, handler: () => void): void
}

export default function DetectionOutlinesLayer({
  viewer,
  overlay,
}: {
  viewer: OutlineViewer
  overlay: DetectionOverlay | null
}) {
  const overlayRef = useRef(overlay)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])

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
      drawDetectionOutline(ctx, viewer, overlayRef.current)
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
    const events = ['animation', 'animation-finish', 'resize', 'viewport-change'] as const
    for (const e of events) viewer.addHandler(e, schedule)
    schedule()
    return () => {
      for (const e of events) viewer.removeHandler(e, schedule)
      cancelAnimationFrame(rafRef.current)
      canvas.remove()
      canvasRef.current = null
    }
  }, [viewer])

  // Immediate redraw when a new preview mask lands — don't wait for the
  // next viewport event.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawDetectionOutline(ctx, viewer, overlay)
  }, [overlay, viewer])

  return null
}
