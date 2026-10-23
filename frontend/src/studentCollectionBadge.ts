/**
 * Geometry shared by the student-curation marker across every collection
 * surface: the `StudentCollectionBadge` DOM icon (tile/table/header scope
 * clusters, graph legend) and the canvas overlay the graph renderer paints on
 * student-curated collection nodes. The artwork is a marbling motif —
 * curved bands and ellipses clipped to a 512-unit circle — stroked in
 * `STUDENT_CURATED_COLOR` so student work reads at a glance.
 */

/** The badge outline/pattern colour — a muted slate that stays legible on
 *  `background.paper` in both colour modes. */
export const STUDENT_CURATED_COLOR = '#5B7A8A'

/** Edge length of the square viewBox the path data is authored in. */
export const STUDENT_BADGE_VIEWBOX = 512

/** Stroke width (in viewBox units) shared by the DOM icon and the canvas
 *  overlay — heavier than the artwork's authored `stroke-width="10"`,
 *  which sub-pixelates into invisibility at badge and node radii. */
export const STUDENT_BADGE_STROKE = 24

/** Rim-ring stroke width (in viewBox units) for the DOM icon, drawn at
 *  `r = 256 - RIM/2` so its outer edge sits exactly on the disc boundary —
 *  the same inset-ring convention the canvas overlay uses (`rr - rimLw/2`).
 *  At the legend's 12–20 px swatch sizes ~40 units lands the ring at the
 *  canvas rim's ~1–1.5 px width. */
export const STUDENT_BADGE_RIM = 40

/** `<path d>` strings for the band artwork, in document order. */
export const STUDENT_BADGE_PATHS: readonly string[] = [
  // Top band
  'M15 70 C95 40,130 40,210 70 C290 100,340 100,497 128',
  'M15 118 C115 155,180 155,270 118 C360 85,410 85,497 108',
  // Second band
  'M15 180 C120 135,190 135,275 175 C360 215,425 215,497 190',
  'M15 225 C95 195,150 195,235 225 C320 255,410 255,497 215',
  // Third band
  'M15 290 C135 235,200 235,290 290 C380 345,430 345,497 315',
  'M15 335 C120 285,180 285,270 335 C360 385,425 385,497 350',
  // Bottom band
  'M15 395 C115 350,180 350,270 395 C360 440,430 440,497 410',
  'M15 440 C115 405,180 405,270 440 C360 475,425 475,497 450',
]

/** Ellipses as `[cx, cy, rx, ry]` tuples, in document order. */
export const STUDENT_BADGE_ELLIPSES: readonly (readonly [number, number, number, number])[] = [
  [105, 90, 34, 16],
  [350, 145, 32, 18],
  [105, 195, 28, 16],
  [325, 255, 42, 16],
  [78, 345, 24, 16],
]

let cachedPath: Path2D | null | undefined

/**
 * The badge artwork as one `Path2D` for the canvas renderer — built once
 * since the geometry never changes. Returns `null` where `Path2D` is
 * unavailable (jsdom), so tests skip the overlay cleanly.
 */
export function studentBadgePath2D(): Path2D | null {
  if (cachedPath === undefined) {
    if (typeof Path2D === 'undefined') {
      cachedPath = null
    } else {
      const p = new Path2D()
      for (const d of STUDENT_BADGE_PATHS) p.addPath(new Path2D(d))
      for (const [cx, cy, rx, ry] of STUDENT_BADGE_ELLIPSES) {
        p.moveTo(cx + rx, cy)
        p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      }
      cachedPath = p
    }
  }
  return cachedPath
}
