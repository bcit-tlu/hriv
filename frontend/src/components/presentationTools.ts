/** Presentation pointer tools (epic #1876): laser pointer + ephemeral ink,
 *  armed only while the OpenSeadragon viewer is in full-page mode. Pure model
 *  math and the SVG layer factory live here so the wiring in ImageViewer stays
 *  small and the visuals stay unit-testable in jsdom (no canvas 2d context). */

const SVG_NS = 'http://www.w3.org/2000/svg'

export type PresentationTool = 'laser' | 'ink'

/** Theme-palette colours driving the overlay (see getPresentationColors). */
export interface PresentationColors {
  laser: string
  ink: string
}

/** Ms a trail point lingers behind the laser dot. */
export const LASER_TRAIL_MS = 450
/** Pooled trail circles (oldest first is dimmest). */
export const LASER_TRAIL_POINTS = 10
export const LASER_CORE_RADIUS = 4.5
export const LASER_GLOW_RADIUS = 14

export const INK_STROKE_WIDTH = 4.6
export const INK_FADE_START_MS = 8_000
export const INK_LIFETIME_MS = 10_000
export const MAX_INK_STROKES = 100
/** Min screen-pixel distance between captured stroke samples. */
export const INK_MIN_POINT_PX = 2

export interface InkStroke {
  /** OpenSeadragon viewport-space points; reprojected to pixels each frame. */
  points: { x: number; y: number }[]
  /** performance.now() stamp set on pointer release; fading starts then. */
  finishedAt: number | null
  element: SVGPathElement
}

/** Stroke opacity for a completed stroke of the given age (ms). Opaque until
 *  INK_FADE_START_MS, then linear to 0 at INK_LIFETIME_MS. */
export function inkStrokeAlpha(ageMs: number): number {
  if (ageMs < INK_FADE_START_MS) return 1
  if (ageMs >= INK_LIFETIME_MS) return 0
  return 1 - (ageMs - INK_FADE_START_MS) / (INK_LIFETIME_MS - INK_FADE_START_MS)
}

/** Trail circle opacity decays linearly to 0 over LASER_TRAIL_MS. */
export function trailAlpha(ageMs: number): number {
  return Math.max(0, 1 - ageMs / LASER_TRAIL_MS)
}

/** SVG `d` for a stroke given pixel-space points (already projected). */
export function strokePathD(pixelPoints: { x: number; y: number }[]): string {
  return pixelPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
}

export interface PresentationLayer {
  /** Root overlay — append to `viewer.canvas` (above `labelContainer`). */
  svg: SVGSVGElement
  inkGroup: SVGGElement
  /** Dot + halo, moved with the pointer while the laser is armed. */
  laserDot: SVGGElement
  /** Fixed pool of trail circles; reused rather than reallocated. */
  trailDots: SVGCircleElement[]
  setLaserPosition(x: number, y: number): void
  setLaserVisible(visible: boolean): void
  createStrokeElement(): SVGPathElement
  /** Re-apply theme colours (e.g. on a light/dark switch). */
  setColors(colors: PresentationColors): void
}

export function createPresentationLayer(colors: PresentationColors): PresentationLayer {
  let currentColors = colors
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('data-hriv-presentation-layer', '')
  svg.setAttribute(
    'style',
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;' +
      'overflow:visible;z-index:11',
  )

  const inkGroup = document.createElementNS(SVG_NS, 'g')
  inkGroup.setAttribute('data-hriv-ink', '')
  svg.appendChild(inkGroup)

  const trailGroup = document.createElementNS(SVG_NS, 'g')
  trailGroup.setAttribute('data-hriv-laser-trail', '')
  trailGroup.setAttribute('display', 'none')
  const trailDots: SVGCircleElement[] = []
  for (let i = 0; i < LASER_TRAIL_POINTS; i += 1) {
    const dot = document.createElementNS(SVG_NS, 'circle')
    dot.setAttribute('fill', colors.laser)
    dot.setAttribute('opacity', '0')
    trailGroup.appendChild(dot)
    trailDots.push(dot)
  }
  svg.appendChild(trailGroup)

  const laserDot = document.createElementNS(SVG_NS, 'g')
  laserDot.setAttribute('data-hriv-laser', '')
  laserDot.setAttribute('display', 'none')
  const glow = document.createElementNS(SVG_NS, 'circle')
  glow.setAttribute('r', String(LASER_GLOW_RADIUS))
  glow.setAttribute('fill', colors.laser)
  glow.setAttribute('opacity', '0.3')
  const core = document.createElementNS(SVG_NS, 'circle')
  core.setAttribute('r', String(LASER_CORE_RADIUS))
  core.setAttribute('fill', colors.laser)
  laserDot.appendChild(glow)
  laserDot.appendChild(core)
  svg.appendChild(laserDot)

  return {
    svg,
    inkGroup,
    laserDot,
    trailDots,
    setLaserPosition(x, y) {
      laserDot.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
    },
    setLaserVisible(visible) {
      laserDot.setAttribute('display', visible ? '' : 'none')
      trailGroup.setAttribute('display', visible ? '' : 'none')
      if (!visible) {
        for (const dot of trailDots) dot.setAttribute('opacity', '0')
      }
    },
    createStrokeElement() {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', currentColors.ink)
      path.setAttribute('stroke-width', String(INK_STROKE_WIDTH))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      inkGroup.appendChild(path)
      return path
    },
    setColors(next) {
      currentColors = next
      core.setAttribute('fill', next.laser)
      glow.setAttribute('fill', next.laser)
      for (const dot of trailDots) dot.setAttribute('fill', next.laser)
      for (const path of inkGroup.children) path.setAttribute('stroke', next.ink)
    },
  }
}
