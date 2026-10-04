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

type TransformedDimensionsOptions = Parameters<fabric.Line['_getTransformedDimensions']>[0]

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
   * Line dims inflated by the arrowhead extent on every side. Only the
   * selection-box / hit-test pipeline (calcACoords → getCoords →
   * containsPoint, and the controls box via _calculateCurrentDimensions)
   * uses this. `_getTransformedDimensions` itself stays untouched: the
   * left/top ↔ centre math and arrow serialisation must keep using the
   * shaft's real extents so the glyph does not shift when edit mode
   * opens or saves (#1363).
   */
  private _paddedTransformedDimensions(options?: TransformedDimensionsOptions) {
    const style = (this as ArrowAnnotatedObject)._arrowStyle ?? 'standard'
    if (style === 'none') return super._getTransformedDimensions(options)
    const pad = arrowHeadLength(options?.strokeWidth ?? this.strokeWidth ?? 1)
    return super._getTransformedDimensions({
      ...options,
      width: (options?.width ?? this.width) + pad * 2,
      height: (options?.height ?? this.height) + pad * 2,
    })
  }

  /**
   * Corner coords for hit-testing and bounding rects — the same geometry as
   * the base implementation but sized by the padded dims, centred on the
   * un-inflated centre so the box grows around the painted arrow.
   */
  override calcACoords(): ReturnType<fabric.Line['calcACoords']> {
    const rotateMatrix = fabric.util.createRotateMatrix({ angle: this.angle })
    const { x, y } = this.getRelativeCenterPoint()
    const finalMatrix = fabric.util.multiplyTransformMatrices(
      fabric.util.createTranslateMatrix(x, y),
      rotateMatrix,
    )
    const dim = this._paddedTransformedDimensions()
    const w = dim.x / 2
    const h = dim.y / 2
    return {
      tl: fabric.util.transformPoint(new fabric.Point(-w, -h), finalMatrix),
      tr: fabric.util.transformPoint(new fabric.Point(w, -h), finalMatrix),
      br: fabric.util.transformPoint(new fabric.Point(w, h), finalMatrix),
      bl: fabric.util.transformPoint(new fabric.Point(-w, h), finalMatrix),
    }
  }

  /**
   * Control-box dims (selection border + handle positions), same formula as
   * the base implementation over the padded dims so the drawn selection box
   * matches the inflated hit area.
   */
  override _calculateCurrentDimensions(options?: TransformedDimensionsOptions) {
    const vpt = this.canvas?.viewportTransform
    const dim = this._paddedTransformedDimensions(options)
    if (vpt) {
      return dim
        .multiply(new fabric.Point(Math.hypot(vpt[0], vpt[1]), Math.hypot(vpt[2], vpt[3])))
        .scalarAdd(2 * this.padding)
    }
    return dim.scalarAdd(2 * this.padding)
  }
}
