/**
 * Unit tests for the presentation pointer helpers (epic #1876): fade curves,
 * path building and the SVG layer factory.
 */

import { describe, it, expect } from 'vitest'
import {
  createPresentationLayer,
  inkStrokeAlpha,
  strokePathD,
  trailAlpha,
  INK_FADE_START_MS,
  INK_LIFETIME_MS,
  INK_STROKE_WIDTH,
  LASER_TRAIL_MS,
  LASER_TRAIL_POINTS,
  type PresentationColors,
} from '../src/components/presentationTools'

// The real values come from the theme palette; fixtures mirror them.
const COLORS: PresentationColors = { laser: '#FF2D2D', ink: '#00E5FF' }

describe('inkStrokeAlpha', () => {
  it('is fully opaque until the fade window starts', () => {
    expect(inkStrokeAlpha(0)).toBe(1)
    expect(inkStrokeAlpha(4_000)).toBe(1)
    expect(inkStrokeAlpha(INK_FADE_START_MS - 1)).toBe(1)
  })

  it('fades linearly across the final two seconds', () => {
    expect(inkStrokeAlpha(INK_FADE_START_MS)).toBe(1)
    expect(inkStrokeAlpha(9_000)).toBeCloseTo(0.5, 5)
    expect(inkStrokeAlpha(9_500)).toBeCloseTo(0.25, 5)
  })

  it('expires at the lifetime bound', () => {
    expect(inkStrokeAlpha(INK_LIFETIME_MS)).toBe(0)
    expect(inkStrokeAlpha(INK_LIFETIME_MS + 5_000)).toBe(0)
  })
})

describe('trailAlpha', () => {
  it('decays linearly to zero over the trail window', () => {
    expect(trailAlpha(0)).toBe(1)
    expect(trailAlpha(LASER_TRAIL_MS / 2)).toBeCloseTo(0.5, 5)
    expect(trailAlpha(LASER_TRAIL_MS)).toBe(0)
    expect(trailAlpha(LASER_TRAIL_MS * 2)).toBe(0)
  })
})

describe('strokePathD', () => {
  it('moves to the first point and lines to the rest', () => {
    expect(
      strokePathD([
        { x: 10, y: 10 },
        { x: 40.25, y: 30.125 },
      ]),
    ).toBe('M10.0 10.0 L40.3 30.1')
  })

  it('renders a lone point as a degenerate move', () => {
    expect(strokePathD([{ x: 5, y: 5 }])).toBe('M5.0 5.0')
  })
})

describe('createPresentationLayer', () => {
  it('builds a passive, canvas-sized SVG overlay above the label container', () => {
    const layer = createPresentationLayer(COLORS)
    const style = layer.svg.getAttribute('style') ?? ''
    expect(style).toContain('pointer-events:none')
    expect(style).toContain('position:absolute')
    expect(style).toContain('z-index:11')
  })

  it('keeps the laser hidden until shown, then tracks positions', () => {
    const layer = createPresentationLayer(COLORS)
    expect(layer.laserDot.getAttribute('display')).toBe('none')

    layer.setLaserVisible(true)
    layer.setLaserPosition(12.34, 56.78)
    expect(layer.laserDot.getAttribute('display')).toBe('')
    expect(layer.laserDot.getAttribute('transform')).toBe('translate(12.3 56.8)')
    expect(layer.laserDot.querySelectorAll('circle')[1].getAttribute('fill')).toBe(COLORS.laser)

    layer.setLaserVisible(false)
    expect(layer.laserDot.getAttribute('display')).toBe('none')
    expect(layer.trailDots.every((d) => d.getAttribute('opacity') === '0')).toBe(true)
  })

  it('pools the configured number of trail circles', () => {
    const layer = createPresentationLayer(COLORS)
    expect(layer.trailDots).toHaveLength(LASER_TRAIL_POINTS)
  })

  it('creates round-capped cyan stroke elements inside the ink group', () => {
    const layer = createPresentationLayer(COLORS)
    const path = layer.createStrokeElement()
    expect(path.parentElement).toBe(layer.inkGroup)
    expect(path.getAttribute('stroke')).toBe(COLORS.ink)
    expect(path.getAttribute('stroke-width')).toBe(String(INK_STROKE_WIDTH))
    expect(path.getAttribute('stroke-linecap')).toBe('round')
    expect(path.getAttribute('fill')).toBe('none')
  })

  it('re-themes laser, trail and existing strokes via setColors', () => {
    const layer = createPresentationLayer(COLORS)
    const path = layer.createStrokeElement()
    const next: PresentationColors = { laser: '#123456', ink: '#654321' }
    layer.setColors(next)

    expect(layer.laserDot.querySelectorAll('circle')[1].getAttribute('fill')).toBe(next.laser)
    expect(layer.trailDots.every((d) => d.getAttribute('fill') === next.laser)).toBe(true)
    expect(path.getAttribute('stroke')).toBe(next.ink)
    expect(layer.createStrokeElement().getAttribute('stroke')).toBe(next.ink)
  })
})
