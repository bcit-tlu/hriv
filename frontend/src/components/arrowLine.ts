import * as fabric from 'fabric'

export type ArrowStyle = 'none' | 'standard' | 'triangle' | 'circle'

/** Arrowhead length drawn at the head endpoint (matches view-mode rendering). */
export function arrowHeadLength(strokeWidth: number): number {
  return Math.max(24, strokeWidth * 12)
}

/**
 * Draw an arrowhead at the end of a line on a plain canvas context.
 */
export function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number,
  color: string,
  style: ArrowStyle,
  lineWidth: number,
) {
  if (style === 'none') return
  const angle = Math.atan2(y2 - y1, x2 - x1)

  if (style === 'circle') {
    const radius = headLen / 2
    ctx.beginPath()
    ctx.arc(x2, y2, radius, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
    return
  }

  // 'standard' = open V, 'triangle' = filled triangle
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  )
  if (style === 'triangle') {
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6),
    )
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  } else {
    // standard: draw both prongs as stroked lines
    ctx.moveTo(x2, y2)
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6),
    )
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
}

type ArrowAnnotatedObject = fabric.FabricObject & {
  _arrowStyle?: ArrowStyle
}

/**
 * Line that renders its arrowhead on the fabric edit canvas, matching the
 * view-mode canvas rendering. Caching is disabled by the creation sites so
 * the head (which extends beyond the line's bounding box) is not clipped.
 */
export class ArrowLine extends fabric.Line {
  override _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx)
    const style = (this as ArrowAnnotatedObject)._arrowStyle ?? 'standard'
    if (style === 'none') return
    const p = this.calcLinePoints()
    const sw = this.strokeWidth ?? 1
    const headLen = arrowHeadLength(sw)
    drawArrowhead(
      ctx,
      p.x1,
      p.y1,
      p.x2,
      p.y2,
      headLen,
      typeof this.stroke === 'string' ? this.stroke : '#000000',
      style,
      Math.max(1, sw),
    )
  }

  /**
   * The arrowhead is drawn up to headLen past the head endpoint and off the
   * line's axis, so the line's own extents under-cover the rendered ink and
   * the selection box is too small to grab (#1363). Inflating the object
   * dimensions here flows through fabric's calcACoords / getBoundingRect /
   * _calculateCurrentDimensions, keeping the selection outline, corner
   * handles, and hit-testing consistent. Rendering uses the un-inflated
   * width/height fields, so the drawn geometry does not move.
   */
  override _getTransformedDimensions(options?: {
    scaleX?: number
    scaleY?: number
    skewX?: number
    skewY?: number
    width?: number
    height?: number
    strokeWidth?: number
  }) {
    const style = (this as ArrowAnnotatedObject)._arrowStyle ?? 'standard'
    if (style === 'none') return super._getTransformedDimensions(options)
    const pad = arrowHeadLength(options?.strokeWidth ?? this.strokeWidth ?? 1)
    return super._getTransformedDimensions({
      ...options,
      width: (options?.width ?? this.width) + pad * 2,
      height: (options?.height ?? this.height) + pad * 2,
    })
  }
}
