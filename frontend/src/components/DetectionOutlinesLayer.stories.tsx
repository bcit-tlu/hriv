import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'

import { tintOutlineMask, type DetectionOverlay } from '../detectionOutlines'
import DetectionOutlinesLayer, { type OutlineViewer } from './DetectionOutlinesLayer'

/**
 * A fixed 400×300 "slide" with pale cells and a matching category mask at
 * work_scale 0.25 (mask 100×75 → level-0 400×300): four uniform discs
 * count as selected (green), one large and one small sit outside the
 * dominant window (vermillion).
 */
const SCALE = 4
const MASK_W = 100
const MASK_H = 75
const SELECTED_DISCS = [
  { cx: 20, cy: 22, r: 8 },
  { cx: 48, cy: 18, r: 8 },
  { cx: 74, cy: 26, r: 8 },
  { cx: 26, cy: 56, r: 8 },
]
const REJECTED_DISCS = [
  { cx: 70, cy: 58, r: 13 },
  { cx: 55, cy: 42, r: 4 },
]

function categoryMask(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(MASK_W * MASK_H * 4)
  const paint = (cx: number, cy: number, r: number, v: number) => {
    for (let y = 0; y < MASK_H; y += 1)
      for (let x = 0; x < MASK_W; x += 1)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          const o = (y * MASK_W + x) * 4
          data[o] = data[o + 1] = data[o + 2] = v
          data[o + 3] = 255
        }
  }
  for (const d of SELECTED_DISCS) paint(d.cx, d.cy, d.r, 2)
  for (const d of REJECTED_DISCS) paint(d.cx, d.cy, d.r, 1)
  return data
}

function buildOverlay(): DetectionOverlay {
  const canvas = document.createElement('canvas')
  canvas.width = MASK_W
  canvas.height = MASK_H
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const tinted = tintOutlineMask(categoryMask(), MASK_W, MASK_H)
    ctx.putImageData(new ImageData(tinted, MASK_W, MASK_H), 0, 0)
  }
  return { canvas, workScale: 1 / SCALE }
}

/** The pale slide the mask overlays — the same discs untinted, so the tint
 * reads as detection feedback rather than arbitrary blobs. */
function paintSlide(el: HTMLCanvasElement) {
  el.width = MASK_W * SCALE
  el.height = MASK_H * SCALE
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#f0ecec'
  ctx.fillRect(0, 0, el.width, el.height)
  ctx.fillStyle = '#d7a8b0'
  for (const d of [...SELECTED_DISCS, ...REJECTED_DISCS]) {
    ctx.beginPath()
    ctx.arc(d.cx * SCALE, d.cy * SCALE, d.r * SCALE, 0, Math.PI * 2)
    ctx.fill()
  }
}

function Surface({ overlay }: { overlay: DetectionOverlay | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLCanvasElement>(null)
  const [viewer, setViewer] = useState<OutlineViewer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const slide = slideRef.current
    if (!host || !slide) return
    paintSlide(slide)
    setViewer({
      canvas: host,
      viewport: {
        // 1 element px = 1 level-0 px: the mask's / workScale extent
        // (400×300) already matches the slide, no extra scaling here.
        imageToViewerElementCoordinates: (p) => p,
      },
      addHandler: () => {},
      removeHandler: () => {},
    })
  }, [])

  return (
    <div
      ref={hostRef}
      style={{ position: 'relative', width: MASK_W * SCALE, height: MASK_H * SCALE }}
    >
      <canvas ref={slideRef} style={{ position: 'absolute', inset: 0 }} />
      {viewer && <DetectionOutlinesLayer viewer={viewer} overlay={overlay} />}
    </div>
  )
}

const meta: Meta<typeof Surface> = {
  title: 'Components/DetectionOutlinesLayer',
  component: Surface,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof Surface>

const OVERLAY = buildOverlay()

export const Basic: Story = { args: { overlay: OVERLAY } }

/** Nothing to paint until the first preview response lands. */
export const NoMask: Story = { args: { overlay: null } }
