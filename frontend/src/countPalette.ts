/**
 * Colour-blind-safe palette for object-count outlines and legend rows
 * (epic #1661). Okabe–Ito: distinguishable under the common colour-vision
 * deficiencies and on both light and dark surfaces.
 */

export const COUNT_GROUP_PALETTE = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#CC79A7', // reddish purple
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#F0E442', // yellow
] as const

/** Deterministic group -> colour mapping; wraps modulo the palette size. */
export function countGroupColor(group: number): string {
  const n = COUNT_GROUP_PALETTE.length
  return COUNT_GROUP_PALETTE[((group % n) + n) % n]
}

/** Groups are unnamed (appearance clusters, not object types): "Group 1"… */
export function countGroupLabel(group: number): string {
  return `Group ${group + 1}`
}
