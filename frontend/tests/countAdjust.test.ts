/**
 * countAdjust (#1746): combined/visible object lists, group derivation,
 * polygon geometry, drawn-circle outlines, nearest-group assignment and
 * the median click radius.
 */

import { describe, it, expect } from 'vitest'

import {
  circlePolygon,
  combinedObjects,
  countGroups,
  medianRadius,
  nearestGroup,
  polygonArea,
  polygonCentroid,
  visibleObjects,
} from '../src/countAdjust'
import type { ApiCountObject } from '../src/api'
import type { CountObject } from '../src/countAdjust'

function square(cx: number, cy: number, half: number): [number, number][] {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ]
}

const OBJ_A: ApiCountObject = { group: 0, centroid: [10, 10], polygon: square(10, 10, 5) }
const OBJ_B: ApiCountObject = { group: 1, centroid: [40, 40], polygon: square(40, 40, 10) }
const ADDED: CountObject = {
  group: 1,
  centroid: [70, 70],
  polygon: square(70, 70, 8),
  manual: true,
}

describe('combinedObjects / visibleObjects', () => {
  it('appends added objects after the API objects', () => {
    const combined = combinedObjects([OBJ_A, OBJ_B], [ADDED])
    expect(combined).toHaveLength(3)
    expect(combined[2].manual).toBe(true)
  })

  it('drops removed combined indices from either list', () => {
    // Index 0 = OBJ_A; index 2 = added[0].
    const visible = visibleObjects([OBJ_A, OBJ_B], [ADDED], [0, 2])
    expect(visible).toEqual([OBJ_B])
  })

  it('accepts a Set of removed indices', () => {
    const visible = visibleObjects([OBJ_A], [ADDED], new Set([1]))
    expect(visible).toEqual([OBJ_A])
  })
})

describe('countGroups', () => {
  it('sums objects per group in ascending order, skipping empty groups', () => {
    const objects = [
      { group: 2 },
      { group: 0 },
      { group: 2 },
      { group: 0 },
      { group: 0 },
      { group: 1 },
    ]
    expect(countGroups(objects)).toEqual([
      { group: 0, count: 3 },
      { group: 1, count: 1 },
      { group: 2, count: 2 },
    ])
  })

  it('returns no rows when nothing remains', () => {
    expect(countGroups([])).toEqual([])
  })
})

describe('polygonArea / polygonCentroid', () => {
  it('computes the area of a square', () => {
    expect(polygonArea(square(0, 0, 5))).toBe(100)
  })

  it('is winding-order independent', () => {
    expect(polygonArea([...square(0, 0, 5)].reverse())).toBe(100)
  })

  it('finds the centroid', () => {
    expect(polygonCentroid(square(20, 30, 5))).toEqual([20, 30])
  })
})

describe('circlePolygon', () => {
  it('produces a ring around the centre with the requested radius', () => {
    const poly = circlePolygon(50, 60, 10, 16)
    expect(poly).toHaveLength(16)
    for (const [x, y] of poly) {
      expect(Math.hypot(x - 50, y - 60)).toBeCloseTo(10, 5)
    }
  })
})

describe('nearestGroup', () => {
  it('assigns the group whose mean area is closest', () => {
    const candidates = [
      { group: 0, polygon: square(0, 0, 5) }, // 100 px²
      { group: 0, polygon: square(0, 0, 6) }, // 144 px²
      { group: 1, polygon: square(0, 0, 20) }, // 1600 px²
    ]
    // New outline ~100 px² -> group 0 (mean 122) over group 1 (1600).
    expect(nearestGroup(square(0, 0, 5), candidates)).toBe(0)
    // ~1500 px² -> group 1.
    expect(nearestGroup(square(0, 0, 19), candidates)).toBe(1)
  })

  it('falls back to group 0 when nothing remains to compare', () => {
    expect(nearestGroup(square(0, 0, 5), [])).toBe(0)
  })
})

describe('medianRadius', () => {
  it('returns the median equivalent radius of the objects', () => {
    // Areas 100π, 400π, 900π -> radii 10, 20, 30 -> median 20.
    const objects = [
      { polygon: circlePolygon(0, 0, 10) },
      { polygon: circlePolygon(0, 0, 20) },
      { polygon: circlePolygon(0, 0, 30) },
    ]
    expect(medianRadius(objects, 5)).toBeCloseTo(20, 0)
  })

  it('averages the two middle values for an even count', () => {
    const objects = [{ polygon: circlePolygon(0, 0, 10) }, { polygon: circlePolygon(0, 0, 20) }]
    expect(medianRadius(objects, 5)).toBeCloseTo(15, 0)
  })

  it('uses the fallback when no objects remain', () => {
    expect(medianRadius([], 7.5)).toBe(7.5)
  })
})
