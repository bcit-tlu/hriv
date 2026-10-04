import { describe, expect, it } from 'vitest'
import { Line, Point } from 'fabric'
import { ArrowLine, arrowHeadLength } from '../../src/components/arrowLine'

/**
 * Real-fabric geometry tests for ArrowLine (#1363): the selection box and
 * hit area must cover the arrowhead that _render draws past the line's own
 * endpoints, not just the bare line segment.
 */
describe('ArrowLine bounding box', () => {
  it('inflates the box so a near-horizontal arrowhead is enclosed', () => {
    const arrow = new ArrowLine([0, 0, 100, 0], {
      stroke: '#000000',
      strokeWidth: 2,
      objectCaching: false,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'

    const rect = arrow.getBoundingRect()
    const headLen = arrowHeadLength(2)
    // The head flares ±headLen around the shaft: the box must be at least
    // 2*headLen tall rather than hugging the ~2px-tall line.
    expect(rect.height).toBeGreaterThanOrEqual(headLen * 2)
    expect(rect.width).toBeGreaterThanOrEqual(100 + headLen * 2)
  })

  it('makes the arrowhead area clickable via containsPoint', () => {
    const arrow = new ArrowLine([0, 0, 100, 0], {
      stroke: '#000000',
      strokeWidth: 2,
      objectCaching: false,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'
    arrow.setCoords()

    // A point well above the shaft, inside the inflated box.
    expect(arrow.containsPoint(new Point(50, 15))).toBe(true)
    // Far outside the box remains a miss.
    expect(arrow.containsPoint(new Point(50, 60))).toBe(false)
  })

  it('keeps plain-line behavior when arrowStyle is none', () => {
    const arrow = new ArrowLine([0, 0, 100, 0], {
      stroke: '#000000',
      strokeWidth: 2,
      objectCaching: false,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'none'

    const plain = new Line([0, 0, 100, 0], { stroke: '#000000', strokeWidth: 2 })
    expect(arrow.getBoundingRect().height).toBeCloseTo(plain.getBoundingRect().height)
  })

  it('scales the box with the stroke-width-derived head length', () => {
    const thin = new ArrowLine([0, 0, 100, 0], { strokeWidth: 2 })
    const thick = new ArrowLine([0, 0, 100, 0], { strokeWidth: 10 })
    ;(thin as { _arrowStyle?: string })._arrowStyle = 'standard'
    ;(thick as { _arrowStyle?: string })._arrowStyle = 'standard'

    expect(thick.getBoundingRect().height).toBeGreaterThan(thin.getBoundingRect().height)
  })

  it('gives a zero-length arrow a grabbable box', () => {
    const arrow = new ArrowLine([50, 50, 50, 50], {
      stroke: '#000000',
      strokeWidth: 2,
      objectCaching: false,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'

    const rect = arrow.getBoundingRect()
    expect(rect.width).toBeGreaterThanOrEqual(arrowHeadLength(2) * 2)
    expect(rect.height).toBeGreaterThanOrEqual(arrowHeadLength(2) * 2)
  })

  it('keeps left/top and centre identical to a plain line', () => {
    // The arrowhead padding must not shift the shaft's placement (#1363):
    // left/top-pinning and the centre math use the un-inflated dims.
    const arrow = new ArrowLine([0, 0, 100, 0], {
      left: 10,
      top: 20,
      originX: 'left',
      originY: 'top',
      stroke: '#000000',
      strokeWidth: 2,
    })
    const plain = new Line([0, 0, 100, 0], {
      left: 10,
      top: 20,
      originX: 'left',
      originY: 'top',
      stroke: '#000000',
      strokeWidth: 2,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'

    expect(arrow.left).toBe(plain.left)
    expect(arrow.top).toBe(plain.top)
    expect(arrow.getRelativeCenterPoint().x).toBe(plain.getRelativeCenterPoint().x)
    expect(arrow.getRelativeCenterPoint().y).toBe(plain.getRelativeCenterPoint().y)
  })

  it('keeps shaft placement consistent after endpoint updates', () => {
    const options = {
      left: 10,
      top: 20,
      originX: 'left' as const,
      originY: 'top' as const,
      strokeWidth: 2,
    }
    const arrow = new ArrowLine([0, 0, 100, 0], options)
    const plain = new Line([0, 0, 100, 0], options)
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'

    arrow.set({ x2: 200, y2: 40 })
    plain.set({ x2: 200, y2: 40 })

    expect(arrow.left).toBeCloseTo(plain.left)
    expect(arrow.top).toBeCloseTo(plain.top)
    expect(arrow.width).toBe(plain.width)
    expect(arrow.height).toBe(plain.height)
  })

  it('covers a rotated arrow', () => {
    const arrow = new ArrowLine([0, 0, 100, 0], {
      stroke: '#000000',
      strokeWidth: 2,
      angle: 45,
      objectCaching: false,
    })
    ;(arrow as { _arrowStyle?: string })._arrowStyle = 'standard'
    arrow.setCoords()

    const rect = arrow.getBoundingRect()
    const span = 100 * Math.SQRT1_2 // shaft's axis projection
    const headLen = arrowHeadLength(2)
    expect(rect.width).toBeGreaterThanOrEqual(span + headLen * Math.SQRT1_2 * 2 - 1)
    expect(rect.height).toBeGreaterThanOrEqual(span + headLen * Math.SQRT1_2 * 2 - 1)
  })
})
