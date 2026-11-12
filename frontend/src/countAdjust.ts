/**
 * Pure helpers for manual count adjustment (#1746): combined/visible
 * object lists, group-count derivation, polygon geometry, circle outlines
 * for user-drawn additions, and the nearest-group assignment that decides
 * which legend row a manually added outline lands in.
 *
 * Everything operates in level-0 image coordinates — the same space as
 * ``ApiCountObject.polygon`` and the report's SVG viewBox.
 */

import type { ApiCountGroup, ApiCountObject } from './api'

/** An outlined object; ``manual`` marks outlines the user drew (#1746). */
export interface CountObject extends ApiCountObject {
  manual?: boolean
}

/** Indices into the combined list below — API objects first, then added. */
export function combinedObjects(objects: ApiCountObject[], added: CountObject[]): CountObject[] {
  return [...objects, ...added]
}

/** Objects still counted after dropping the removed combined indices. */
export function visibleObjects(
  objects: ApiCountObject[],
  added: CountObject[],
  removed: ReadonlySet<number> | readonly number[],
): CountObject[] {
  const skip = removed instanceof Set ? removed : new Set(removed)
  return combinedObjects(objects, added).filter((_, i) => !skip.has(i))
}

/** Recompute the legend's per-group rows (ascending group, no zero rows). */
export function countGroups(objects: readonly { group: number }[]): ApiCountGroup[] {
  const counts = new Map<number, number>()
  for (const o of objects) counts.set(o.group, (counts.get(o.group) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([group, count]) => ({ group, count }))
}

/** Shoelace area of a level-0 polygon (px²). */
export function polygonArea(polygon: [number, number][]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/** Average vertex position — display-only, for manual outlines. */
export function polygonCentroid(polygon: [number, number][]): [number, number] {
  let sx = 0
  let sy = 0
  for (const [x, y] of polygon) {
    sx += x
    sy += y
  }
  const n = polygon.length || 1
  return [sx / n, sy / n]
}

/** Regular N-gon approximating a circle, for user-drawn outlines. */
export function circlePolygon(
  cx: number,
  cy: number,
  r: number,
  segments = 24,
): [number, number][] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2 - Math.PI / 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/**
 * Assign a drawn outline to the closest-size group: the group whose mean
 * polygon area is nearest the new outline's area. Groups are appearance
 * clusters, so a same-size object most likely belongs there. Falls back
 * to group 0 when nothing remains to compare against.
 */
export function nearestGroup(
  polygon: [number, number][],
  candidates: readonly { group: number; polygon: [number, number][] }[],
): number {
  const area = polygonArea(polygon)
  const sums = new Map<number, { total: number; n: number }>()
  for (const o of candidates) {
    const s = sums.get(o.group) ?? { total: 0, n: 0 }
    s.total += polygonArea(o.polygon)
    s.n += 1
    sums.set(o.group, s)
  }
  let best = 0
  let bestDist = Infinity
  for (const [group, s] of sums) {
    const dist = Math.abs(s.total / s.n - area)
    if (dist < bestDist) {
      bestDist = dist
      best = group
    }
  }
  return best
}

/**
 * Radius a plain click should draw: the median equivalent radius
 * (sqrt(area/π)) of the current objects, so a clicked missed object gets
 * an outline the same size as its neighbours. Falls back to ~1.5% of the
 * smaller selection side when nothing is left.
 */
export function medianRadius(
  objects: readonly { polygon: [number, number][] }[],
  fallback: number,
): number {
  const radii = objects
    .map((o) => Math.sqrt(polygonArea(o.polygon) / Math.PI))
    .sort((a, b) => a - b)
  if (radii.length === 0) return fallback
  const mid = Math.floor(radii.length / 2)
  return radii.length % 2 === 0 ? (radii[mid - 1] + radii[mid]) / 2 : radii[mid]
}
