import { useEffect, useRef, useState, useCallback } from 'react'
import OpenSeadragon from 'openseadragon'
import * as fabric from 'fabric'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Popover from '@mui/material/Popover'

// MUI Icons
import CropSquareIcon from '@mui/icons-material/CropSquare'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import LinkIcon from '@mui/icons-material/Link'
import DeleteIcon from '@mui/icons-material/Delete'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import CheckIcon from '@mui/icons-material/Check'
import PaletteIcon from '@mui/icons-material/Palette'
import LineWeightIcon from '@mui/icons-material/LineWeight'

/** Serialisable annotation stored in image metadata */
export interface CanvasAnnotation {
  id: string
  type: 'rect' | 'circle' | 'arrow' | 'text' | 'link'
  /** Viewport X (OSD viewport coordinate) */
  vpX: number
  /** Viewport Y (OSD viewport coordinate) */
  vpY: number
  /** Viewport width */
  vpWidth: number
  /** Viewport height */
  vpHeight: number
  color: string
  strokeWidth?: number
  /** For text / link */
  text?: string
  /** For link type */
  url?: string
  /** Viewport-relative font size */
  vpFontSize?: number
  /** Arrow endpoint in viewport coords */
  vpX2?: number
  /** Arrow endpoint in viewport coords */
  vpY2?: number
  /** Arrow head style */
  arrowStyle?: 'none' | 'standard' | 'triangle' | 'circle'
  /** Whether shape is filled (rect/circle) */
  filled?: boolean
}

const PALETTE = [
  '#000000', // Black (default)
  '#FF0000', // Red
  '#2196F3', // Blue
  '#4CAF50', // Green
  '#FFEB3B', // Yellow
  '#FF9800', // Orange
  '#9C27B0', // Purple
  '#FFFFFF', // White
]

const LINE_WIDTHS = [1, 2, 4, 8]

type ArrowStyle = 'none' | 'standard' | 'triangle' | 'circle'
type FillMode = 'outlined' | 'filled'
type Tool = 'select' | 'rect' | 'circle' | 'arrow' | 'text' | 'link'

/** Custom properties attached to fabric objects */
type AnnotatedObject = fabric.FabricObject & {
  _annotationId?: string
  _annotationType?: string
  _linkUrl?: string
  _arrowStyle?: ArrowStyle
  _filled?: boolean
}

interface CanvasOverlayProps {
  viewer: OpenSeadragon.Viewer
  annotations: CanvasAnnotation[]
  onAnnotationsChange: (annotations: CanvasAnnotation[]) => void
  canEdit: boolean
  editMode: boolean
  onEditModeChange: (mode: boolean) => void
  /** Flush any pending annotation save immediately (bypass debounce) */
  onFlushAnnotations?: () => Promise<void>
}

const LOG_PREFIX = '[CanvasOverlay]'

/** Generate a short random ID */
function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Draw an arrowhead at the end of a line on a plain canvas context.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number,
  color: string,
  style: ArrowStyle,
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
    ctx.lineWidth = Math.max(1, headLen / 4)
    ctx.stroke()
  }
}

export default function CanvasOverlay({
  viewer,
  annotations,
  onAnnotationsChange,
  canEdit: _canEdit,
  editMode,
  onFlushAnnotations,
  onEditModeChange,
}: CanvasOverlayProps) {
  // _canEdit reserved for future per-tool gating; edit button visibility is handled by parent
  void _canEdit
  const viewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const fabricElRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [activeColor, setActiveColor] = useState('#000000')
  const [activeLineWidth, setActiveLineWidth] = useState(2)
  const [activeArrowStyle, setActiveArrowStyle] = useState<ArrowStyle>('standard')
  const [activeFillMode, setActiveFillMode] = useState<FillMode>('outlined')
  const [colorPickerAnchor, setColorPickerAnchor] = useState<HTMLElement | null>(null)
  const [lineWidthAnchor, setLineWidthAnchor] = useState<HTMLElement | null>(null)
  const [arrowAnchor, setArrowAnchor] = useState<HTMLElement | null>(null)
  const [rectAnchor, setRectAnchor] = useState<HTMLElement | null>(null)
  const [circleAnchor, setCircleAnchor] = useState<HTMLElement | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const annotationsRef = useRef(annotations)
  const isDrawingRef = useRef(false)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawObjRef = useRef<fabric.FabricObject | null>(null)

  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  // View mode: render annotations on a plain canvas
  const redrawViewCanvas = useCallback(() => {
    const canvas = viewCanvasRef.current
    if (!canvas || !viewer.viewport) return

    const container = viewer.container
    const w = container.clientWidth
    const h = container.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)

    for (const ann of annotationsRef.current) {
      const topLeft = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(ann.vpX, ann.vpY),
      )

      if (ann.type === 'arrow') {
        const endPt = viewer.viewport.pixelFromPoint(
          new OpenSeadragon.Point(ann.vpX2 ?? ann.vpX, ann.vpY2 ?? ann.vpY),
        )
        ctx.beginPath()
        ctx.moveTo(topLeft.x, topLeft.y)
        ctx.lineTo(endPt.x, endPt.y)
        ctx.strokeStyle = ann.color
        const sw = (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()
        ctx.lineWidth = Math.max(1, sw)
        ctx.stroke()
        // Arrowhead: 3x larger default
        const headLen = Math.max(24, sw * 12)
        const arrowStyle = ann.arrowStyle ?? 'standard'
        drawArrowhead(ctx, topLeft.x, topLeft.y, endPt.x, endPt.y, headLen, ann.color, arrowStyle)
        continue
      }

      const bottomRight = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(ann.vpX + ann.vpWidth, ann.vpY + ann.vpHeight),
      )
      const pw = bottomRight.x - topLeft.x
      const ph = bottomRight.y - topLeft.y

      if (ann.type === 'rect') {
        const sw = (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()
        ctx.lineWidth = Math.max(1, sw)
        if (ann.filled) {
          ctx.fillStyle = ann.color
          ctx.fillRect(topLeft.x, topLeft.y, pw, ph)
        } else {
          ctx.strokeStyle = ann.color
          ctx.strokeRect(topLeft.x, topLeft.y, pw, ph)
        }
      } else if (ann.type === 'circle') {
        ctx.beginPath()
        ctx.ellipse(
          topLeft.x + pw / 2,
          topLeft.y + ph / 2,
          Math.abs(pw / 2),
          Math.abs(ph / 2),
          0,
          0,
          2 * Math.PI,
        )
        const sw = (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()
        ctx.lineWidth = Math.max(1, sw)
        if (ann.filled) {
          ctx.fillStyle = ann.color
          ctx.fill()
        } else {
          ctx.strokeStyle = ann.color
          ctx.stroke()
        }
      } else if (ann.type === 'text' || ann.type === 'link') {
        const vpFontSize = ann.vpFontSize ?? 0.02
        const pxFontSize = Math.abs(vpFontSize * (bottomRight.x - topLeft.x) / (ann.vpWidth || 1))
        const fontSize = Math.max(8, pxFontSize)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = ann.color
        if (ann.type === 'link') {
          const text = ann.text || ann.url || 'Link'
          ctx.fillText(text, topLeft.x, topLeft.y + fontSize)
          const textWidth = ctx.measureText(text).width
          ctx.beginPath()
          ctx.moveTo(topLeft.x, topLeft.y + fontSize + 2)
          ctx.lineTo(topLeft.x + textWidth, topLeft.y + fontSize + 2)
          ctx.strokeStyle = ann.color
          ctx.lineWidth = 1
          ctx.stroke()
        } else {
          ctx.fillText(ann.text || '', topLeft.x, topLeft.y + fontSize)
        }
      }
    }
  }, [viewer])

  // Attach view-mode redraw to OSD events
  useEffect(() => {
    if (editMode) return
    const handler = () => redrawViewCanvas()
    viewer.addHandler('animation', handler)
    viewer.addHandler('animation-finish', handler)
    viewer.addHandler('resize', handler)
    redrawViewCanvas()
    return () => {
      viewer.removeHandler('animation', handler)
      viewer.removeHandler('animation-finish', handler)
      viewer.removeHandler('resize', handler)
    }
  }, [viewer, editMode, redrawViewCanvas, annotations])

  // Clickable link layer (view mode)
  const [linkBoxes, setLinkBoxes] = useState<
    Array<{ key: string; left: number; top: number; width: number; height: number; url: string; text: string }>
  >([])

  const updateLinkBoxes = useCallback(() => {
    if (editMode || !viewer.viewport) {
      setLinkBoxes([])
      return
    }
    const boxes = annotationsRef.current
      .filter((a) => a.type === 'link' && a.url)
      .map((a) => {
        const tl = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(a.vpX, a.vpY))
        const br = viewer.viewport.pixelFromPoint(
          new OpenSeadragon.Point(a.vpX + a.vpWidth, a.vpY + a.vpHeight),
        )
        return {
          key: a.id,
          left: tl.x,
          top: tl.y,
          width: br.x - tl.x,
          height: br.y - tl.y,
          url: a.url!,
          text: a.text || a.url!,
        }
      })
    setLinkBoxes(boxes)
  }, [viewer, editMode])

  useEffect(() => {
    if (editMode) return
    const handler = () => updateLinkBoxes()
    viewer.addHandler('animation', handler)
    viewer.addHandler('animation-finish', handler)
    viewer.addHandler('resize', handler)
    const raf = requestAnimationFrame(() => updateLinkBoxes())
    return () => {
      cancelAnimationFrame(raf)
      viewer.removeHandler('animation', handler)
      viewer.removeHandler('animation-finish', handler)
      viewer.removeHandler('resize', handler)
    }
  }, [viewer, editMode, updateLinkBoxes, annotations])

  // Edit mode: fabric.js canvas

  /** Convert viewport annotation to fabric object at current zoom */
  const annotationToFabric = useCallback(
    (ann: CanvasAnnotation): fabric.FabricObject | null => {
      if (!viewer.viewport) return null

      const topLeft = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(ann.vpX, ann.vpY))

      if (ann.type === 'arrow') {
        const endPt = viewer.viewport.pixelFromPoint(
          new OpenSeadragon.Point(ann.vpX2 ?? ann.vpX, ann.vpY2 ?? ann.vpY),
        )
        const line = new fabric.Line(
          [topLeft.x, topLeft.y, endPt.x, endPt.y],
          {
            stroke: ann.color,
            strokeWidth: Math.max(1, (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()),
            selectable: true,
            hasBorders: true,
            hasControls: true,
          },
        )
        const aObj = line as AnnotatedObject
        aObj._annotationId = ann.id
        aObj._annotationType = 'arrow'
        aObj._arrowStyle = ann.arrowStyle ?? 'standard'
        return line
      }

      const bottomRight = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(ann.vpX + ann.vpWidth, ann.vpY + ann.vpHeight),
      )
      const pw = bottomRight.x - topLeft.x
      const ph = bottomRight.y - topLeft.y

      if (ann.type === 'rect') {
        const isFilled = ann.filled ?? false
        const rect = new fabric.Rect({
          left: topLeft.x,
          top: topLeft.y,
          width: Math.abs(pw),
          height: Math.abs(ph),
          fill: isFilled ? ann.color : 'transparent',
          stroke: ann.color,
          strokeWidth: Math.max(1, (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()),
          strokeUniform: true,
        })
        const aObj = rect as AnnotatedObject
        aObj._annotationId = ann.id
        aObj._annotationType = 'rect'
        aObj._filled = isFilled
        return rect
      }

      if (ann.type === 'circle') {
        const isFilled = ann.filled ?? false
        const ellipse = new fabric.Ellipse({
          left: topLeft.x,
          top: topLeft.y,
          rx: Math.abs(pw / 2),
          ry: Math.abs(ph / 2),
          fill: isFilled ? ann.color : 'transparent',
          stroke: ann.color,
          strokeWidth: Math.max(1, (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()),
          strokeUniform: true,
        })
        const aObj = ellipse as AnnotatedObject
        aObj._annotationId = ann.id
        aObj._annotationType = 'circle'
        aObj._filled = isFilled
        return ellipse
      }

      if (ann.type === 'text' || ann.type === 'link') {
        const vpFontSize = ann.vpFontSize ?? 0.02
        const pxFontSize = Math.abs(vpFontSize * pw / (ann.vpWidth || 1))
        const displayText = ann.type === 'link' ? (ann.text || ann.url || 'Link') : (ann.text || '')
        const text = new fabric.IText(displayText, {
          left: topLeft.x,
          top: topLeft.y,
          fontFamily: 'sans-serif',
          fontSize: Math.max(10, pxFontSize),
          fill: ann.color,
          underline: ann.type === 'link',
        })
        const aObj = text as AnnotatedObject
        aObj._annotationId = ann.id
        aObj._annotationType = ann.type
        if (ann.type === 'link') {
          aObj._linkUrl = ann.url || ''
        }
        return text
      }

      return null
    },
    [viewer],
  )

  /** Convert a fabric object back to a viewport-coordinate annotation */
  const fabricToAnnotation = useCallback(
    (obj: fabric.FabricObject): CanvasAnnotation | null => {
      if (!viewer.viewport) return null

      const aObj = obj as AnnotatedObject
      const id = aObj._annotationId || uid()
      const type = (aObj._annotationType as CanvasAnnotation['type']) || 'rect'

      if (type === 'arrow' && obj instanceof fabric.Line) {
        const coords = obj.calcLinePoints()
        const matrix = obj.calcTransformMatrix()
        const startPt = fabric.util.transformPoint(new fabric.Point(coords.x1, coords.y1), matrix)
        const endPt = fabric.util.transformPoint(new fabric.Point(coords.x2, coords.y2), matrix)
        const vpStart = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(startPt.x, startPt.y))
        const vpEnd = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(endPt.x, endPt.y))
        return {
          id,
          type: 'arrow',
          vpX: vpStart.x,
          vpY: vpStart.y,
          vpWidth: 0,
          vpHeight: 0,
          vpX2: vpEnd.x,
          vpY2: vpEnd.y,
          color: (obj.stroke as string) || '#000000',
          strokeWidth: (obj.strokeWidth ?? 2) / viewer.viewport.getZoom(),
          arrowStyle: aObj._arrowStyle ?? 'standard',
        }
      }

      const bound = obj.getBoundingRect()
      const vpTopLeft = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(bound.left, bound.top),
      )
      const vpBottomRight = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(bound.left + bound.width, bound.top + bound.height),
      )

      const base: CanvasAnnotation = {
        id,
        type,
        vpX: vpTopLeft.x,
        vpY: vpTopLeft.y,
        vpWidth: vpBottomRight.x - vpTopLeft.x,
        vpHeight: vpBottomRight.y - vpTopLeft.y,
        color: (obj.stroke as string) || (obj.fill as string) || '#000000',
        strokeWidth: (obj.strokeWidth ?? 2) / viewer.viewport.getZoom(),
      }

      if (type === 'rect' || type === 'circle') {
        base.filled = aObj._filled ?? false
      }

      if (type === 'text' || type === 'link') {
        const textObj = obj as fabric.IText
        base.text = textObj.text || ''
        base.color = (textObj.fill as string) || '#000000'
        // Convert visual font size to viewport units using the bounding-box ratio.
        // vpWidth/pixelWidth is the conversion factor from pixels to viewport units.
        // The old formula (fontSize / zoom) was wrong — it produced values in
        // "font-size / zoom" space, not viewport units, causing the load formula
        // (vpFontSize * pw / vpWidth) to multiply by containerWidth and produce
        // enormous pixel sizes (e.g. 60 000 px), rendering text off-screen.
        const visualFontSize = (textObj.fontSize ?? 16) * (textObj.scaleY ?? 1)
        const pw = bound.width
        base.vpFontSize = pw > 0
          ? visualFontSize * base.vpWidth / pw
          : visualFontSize / viewer.viewport.getZoom()
        if (type === 'link') {
          base.url = aObj._linkUrl || ''
        }
      }

      return base
    },
    [viewer],
  )

  /** Collect all fabric objects and emit change */
  const emitAnnotations = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    // Exit any active IText editing before collecting, so text content is committed
    const active = fc.getActiveObject()
    if (active && active instanceof fabric.IText && active.isEditing) {
      active.exitEditing()
    }
    const objs = fc.getObjects()
    const result: CanvasAnnotation[] = []
    for (const obj of objs) {
      const ann = fabricToAnnotation(obj)
      if (ann) result.push(ann)
    }
    console.debug(LOG_PREFIX, 'emitAnnotations:', result.length, 'objects')
    onAnnotationsChange(result)
  }, [fabricToAnnotation, onAnnotationsChange])

  // Initialize / teardown fabric canvas when entering/exiting edit mode
  useEffect(() => {
    if (!editMode) {
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }
      return
    }

    console.debug(LOG_PREFIX, 'entering edit mode, annotations:', annotationsRef.current.length)

    const container = viewer.container
    const w = container.clientWidth
    const h = container.clientHeight

    if (!fabricElRef.current) return

    fabricElRef.current.width = w
    fabricElRef.current.height = h

    const fc = new fabric.Canvas(fabricElRef.current, {
      width: w,
      height: h,
      selection: true,
    })
    fabricCanvasRef.current = fc

    for (const ann of annotationsRef.current) {
      const obj = annotationToFabric(ann)
      if (obj) fc.add(obj)
    }
    fc.renderAll()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.debug(LOG_PREFIX, 'Escape pressed')
        if (isDrawingRef.current && drawObjRef.current) {
          fc.remove(drawObjRef.current)
          isDrawingRef.current = false
          drawStartRef.current = null
          drawObjRef.current = null
          fc.renderAll()
        }
        const activeObj = fc.getActiveObject()
        if (activeObj && activeObj instanceof fabric.IText && activeObj.isEditing) {
          activeObj.exitEditing()
          fc.renderAll()
        }
        fc.discardActiveObject()
        fc.renderAll()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObj = fc.getActiveObject()
        if (activeObj && activeObj instanceof fabric.IText && activeObj.isEditing) return
        const activeObjs = fc.getActiveObjects()
        if (activeObjs.length > 0) {
          for (const obj of activeObjs) {
            fc.remove(obj)
          }
          fc.discardActiveObject()
          fc.renderAll()
          emitAnnotations()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    // Emit after IText editing exits so text content is saved
    const handleTextEditingExited = () => {
      console.debug(LOG_PREFIX, 'text:editing:exited — emitting annotations')
      emitAnnotations()
    }
    fc.on('text:editing:exited', handleTextEditingExited)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.off('text:editing:exited', handleTextEditingExited)
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }
    }
  }, [editMode, viewer, annotationToFabric, emitAnnotations])

  // Drawing handlers for edit mode

  useEffect(() => {
    const fc = fabricCanvasRef.current
    if (!fc || !editMode) return

    fc.selection = activeTool === 'select'
    fc.forEachObject((obj) => {
      obj.selectable = activeTool === 'select'
      obj.evented = activeTool === 'select'
    })
    fc.renderAll()

    if (activeTool === 'select') {
      fc.defaultCursor = 'default'
      fc.hoverCursor = 'move'
      return
    }

    fc.defaultCursor = 'crosshair'
    fc.hoverCursor = 'crosshair'

    const handleMouseDown = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      if (activeTool === 'text' || activeTool === 'link') return
      console.debug(LOG_PREFIX, 'mouse:down tool=', activeTool)
      isDrawingRef.current = true
      const pointer = fc.getScenePoint(opt.e)
      drawStartRef.current = { x: pointer.x, y: pointer.y }

      if (activeTool === 'rect') {
        const isFilled = activeFillMode === 'filled'
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: isFilled ? activeColor : 'transparent',
          stroke: activeColor,
          strokeWidth: activeLineWidth,
          strokeUniform: true,
          selectable: false,
          evented: false,
        })
        const aObj = rect as AnnotatedObject
        aObj._annotationId = uid()
        aObj._annotationType = 'rect'
        aObj._filled = isFilled
        fc.add(rect)
        drawObjRef.current = rect
      } else if (activeTool === 'circle') {
        const isFilled = activeFillMode === 'filled'
        const ellipse = new fabric.Ellipse({
          left: pointer.x,
          top: pointer.y,
          rx: 0,
          ry: 0,
          fill: isFilled ? activeColor : 'transparent',
          stroke: activeColor,
          strokeWidth: activeLineWidth,
          strokeUniform: true,
          selectable: false,
          evented: false,
        })
        const aObj = ellipse as AnnotatedObject
        aObj._annotationId = uid()
        aObj._annotationType = 'circle'
        aObj._filled = isFilled
        fc.add(ellipse)
        drawObjRef.current = ellipse
      } else if (activeTool === 'arrow') {
        const line = new fabric.Line(
          [pointer.x, pointer.y, pointer.x, pointer.y],
          {
            stroke: activeColor,
            strokeWidth: activeLineWidth,
            selectable: false,
            evented: false,
          },
        )
        const aObj = line as AnnotatedObject
        aObj._annotationId = uid()
        aObj._annotationType = 'arrow'
        aObj._arrowStyle = activeArrowStyle
        fc.add(line)
        drawObjRef.current = line
      }
    }

    const handleMouseMove = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      if (!isDrawingRef.current || !drawStartRef.current || !drawObjRef.current) return
      const pointer = fc.getScenePoint(opt.e)
      const start = drawStartRef.current
      const obj = drawObjRef.current

      if (activeTool === 'rect' && obj instanceof fabric.Rect) {
        const left = Math.min(start.x, pointer.x)
        const top = Math.min(start.y, pointer.y)
        obj.set({
          left,
          top,
          width: Math.abs(pointer.x - start.x),
          height: Math.abs(pointer.y - start.y),
        })
      } else if (activeTool === 'circle' && obj instanceof fabric.Ellipse) {
        const left = Math.min(start.x, pointer.x)
        const top = Math.min(start.y, pointer.y)
        obj.set({
          left,
          top,
          rx: Math.abs(pointer.x - start.x) / 2,
          ry: Math.abs(pointer.y - start.y) / 2,
        })
      } else if (activeTool === 'arrow' && obj instanceof fabric.Line) {
        obj.set({ x2: pointer.x, y2: pointer.y })
      }

      fc.renderAll()
    }

    const handleMouseUp = () => {
      if (!isDrawingRef.current) return
      console.debug(LOG_PREFIX, 'mouse:up — finishing draw')
      isDrawingRef.current = false
      const obj = drawObjRef.current
      if (obj) {
        obj.set({ selectable: true, evented: true })
        obj.setCoords()
      }
      drawStartRef.current = null
      drawObjRef.current = null
      emitAnnotations()
      setActiveTool('select')
    }

    fc.on('mouse:down', handleMouseDown)
    fc.on('mouse:move', handleMouseMove)
    fc.on('mouse:up', handleMouseUp)

    return () => {
      fc.off('mouse:down', handleMouseDown)
      fc.off('mouse:move', handleMouseMove)
      fc.off('mouse:up', handleMouseUp)
    }
  }, [editMode, activeTool, activeColor, activeLineWidth, activeArrowStyle, activeFillMode, emitAnnotations])

  // Emit on object modified (move/resize)
  useEffect(() => {
    const fc = fabricCanvasRef.current
    if (!fc || !editMode) return
    const handler = () => {
      console.debug(LOG_PREFIX, 'object:modified — emitting')
      emitAnnotations()
    }
    fc.on('object:modified', handler)
    return () => {
      fc.off('object:modified', handler)
    }
  }, [editMode, emitAnnotations])

  // Tool actions

  const handleAddText = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    const center = { x: fc.width! / 2, y: fc.height! / 2 }
    const text = new fabric.IText('Text', {
      left: center.x - 90,
      top: center.y - 30,
      fontFamily: 'sans-serif',
      fontSize: 60,
      fill: activeColor,
    })
    const aObj = text as AnnotatedObject
    aObj._annotationId = uid()
    aObj._annotationType = 'text'
    fc.add(text)
    fc.setActiveObject(text)
    fc.renderAll()
    emitAnnotations()
    setActiveTool('select')
  }, [activeColor, emitAnnotations])

  const handleAddLink = useCallback(() => {
    setLinkText('')
    setLinkUrl('')
    setLinkDialogOpen(true)
  }, [])

  const handleLinkConfirm = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc || !linkUrl) return
    setLinkDialogOpen(false)
    const center = { x: fc.width! / 2, y: fc.height! / 2 }
    const text = new fabric.IText(linkText || linkUrl, {
      left: center.x - 120,
      top: center.y - 30,
      fontFamily: 'sans-serif',
      fontSize: 60,
      fill: activeColor,
      underline: true,
    })
    const aObj = text as AnnotatedObject
    aObj._annotationId = uid()
    aObj._annotationType = 'link'
    aObj._linkUrl = linkUrl
    fc.add(text)
    fc.setActiveObject(text)
    fc.renderAll()
    emitAnnotations()
    setActiveTool('select')
  }, [linkText, linkUrl, activeColor, emitAnnotations])

  const handleDeleteSelected = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    const active = fc.getActiveObjects()
    console.debug(LOG_PREFIX, 'deleteSelected:', active.length, 'objects')
    for (const obj of active) {
      fc.remove(obj)
    }
    fc.discardActiveObject()
    fc.renderAll()
    emitAnnotations()
  }, [emitAnnotations])

  const handleClearAll = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    fc.clear()
    fc.renderAll()
    onAnnotationsChange([])
  }, [onAnnotationsChange])

  const handleDone = useCallback(() => {
    console.debug(LOG_PREFIX, 'handleDone — emitting and flushing before exiting edit mode')
    emitAnnotations()
    // Flush immediately (bypass debounce) so data is persisted before exit
    if (onFlushAnnotations) {
      void onFlushAnnotations().then(() => {
        console.debug(LOG_PREFIX, 'flush complete, exiting edit mode')
      })
    }
    onEditModeChange(false)
  }, [emitAnnotations, onEditModeChange, onFlushAnnotations])

  /** Change active color and apply to any selected fabric objects */
  const handleColorChange = useCallback((color: string) => {
    setActiveColor(color)
    setColorPickerAnchor(null)
    const fc = fabricCanvasRef.current
    if (!fc) return
    const active = fc.getActiveObjects()
    if (active.length === 0) return
    console.debug(LOG_PREFIX, 'colorChange applied to', active.length, 'objects')
    for (const obj of active) {
      if (obj instanceof fabric.IText) {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          obj.setSelectionStyles({ fill: color })
        } else {
          obj.set('fill', color)
        }
      } else {
        obj.set('stroke', color)
        const aObj = obj as AnnotatedObject
        if (aObj._filled) {
          obj.set('fill', color)
        }
      }
    }
    fc.renderAll()
    emitAnnotations()
  }, [emitAnnotations])

  /** Change line width and apply to any selected fabric objects (not text/link) */
  const handleLineWidthChange = useCallback((width: number) => {
    setActiveLineWidth(width)
    setLineWidthAnchor(null)
    const fc = fabricCanvasRef.current
    if (!fc) return
    const active = fc.getActiveObjects()
    if (active.length === 0) return
    console.debug(LOG_PREFIX, 'lineWidthChange applied to', active.length, 'objects, width=', width)
    for (const obj of active) {
      const aObj = obj as AnnotatedObject
      const t = aObj._annotationType
      if (t === 'text' || t === 'link') continue
      obj.set('strokeWidth', width)
    }
    fc.renderAll()
    emitAnnotations()
  }, [emitAnnotations])

  if (!editMode && annotations.length === 0) return null

  return (
    <>
      {/* View-mode canvas */}
      {!editMode && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <canvas
            ref={viewCanvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          {linkBoxes.map((lb) => {
            if (!/^https?:\/\//i.test(lb.url)) return null
            return (
              <a
                key={lb.key}
                href={lb.url}
                target="_blank"
                rel="noopener noreferrer"
                title={lb.text}
                style={{
                  position: 'absolute',
                  left: lb.left,
                  top: lb.top,
                  width: lb.width,
                  height: lb.height,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                }}
              />
            )
          })}
        </Box>
      )}

      {/* Edit-mode fabric canvas */}
      {editMode && (
        <Box
          ref={wrapperRef}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 15,
          }}
        >
          <canvas ref={fabricElRef} style={{ display: 'block' }} />
        </Box>
      )}

      {/* Edit-mode toolbar */}
      {editMode && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            bgcolor: 'rgba(0,0,0,0.75)',
            borderRadius: 1,
            px: 1,
            py: 0.5,
          }}
        >
          {/* Rectangle with fill-mode submenu */}
          <Tooltip title="Rectangle">
            <IconButton
              onClick={(e) => setRectAnchor(rectAnchor ? null : e.currentTarget)}
              sx={{
                color: activeTool === 'rect' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'rect' ? 'rgba(255,255,255,0.15)' : 'transparent',
                p: 0.75,
              }}
            >
              <CropSquareIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(rectAnchor)}
            anchorEl={rectAnchor}
            onClose={() => setRectAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{ paper: { sx: { bgcolor: 'rgba(0,0,0,0.85)', borderRadius: 1, p: 0.5, mt: 0.5 } } }}
          >
            <Tooltip title="Outlined Rectangle" placement="right">
              <IconButton
                onClick={() => { setActiveFillMode('outlined'); setActiveTool('rect'); setRectAnchor(null) }}
                sx={{ color: activeFillMode === 'outlined' ? '#90caf9' : 'white', display: 'block' }}
              >
                <CropSquareIcon sx={{ fontSize: 24 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Filled Rectangle" placement="right">
              <IconButton
                onClick={() => { setActiveFillMode('filled'); setActiveTool('rect'); setRectAnchor(null) }}
                sx={{ color: activeFillMode === 'filled' ? '#90caf9' : 'white', display: 'block' }}
              >
                <Box sx={{ width: 20, height: 20, bgcolor: 'currentColor', borderRadius: '2px' }} />
              </IconButton>
            </Tooltip>
          </Popover>

          {/* Circle with fill-mode submenu */}
          <Tooltip title="Circle / Ellipse">
            <IconButton
              onClick={(e) => setCircleAnchor(circleAnchor ? null : e.currentTarget)}
              sx={{
                color: activeTool === 'circle' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'circle' ? 'rgba(255,255,255,0.15)' : 'transparent',
                p: 0.75,
              }}
            >
              <CircleOutlinedIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(circleAnchor)}
            anchorEl={circleAnchor}
            onClose={() => setCircleAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{ paper: { sx: { bgcolor: 'rgba(0,0,0,0.85)', borderRadius: 1, p: 0.5, mt: 0.5 } } }}
          >
            <Tooltip title="Outlined Circle" placement="right">
              <IconButton
                onClick={() => { setActiveFillMode('outlined'); setActiveTool('circle'); setCircleAnchor(null) }}
                sx={{ color: activeFillMode === 'outlined' ? '#90caf9' : 'white', display: 'block' }}
              >
                <CircleOutlinedIcon sx={{ fontSize: 24 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Filled Circle" placement="right">
              <IconButton
                onClick={() => { setActiveFillMode('filled'); setActiveTool('circle'); setCircleAnchor(null) }}
                sx={{ color: activeFillMode === 'filled' ? '#90caf9' : 'white', display: 'block' }}
              >
                <Box sx={{ width: 20, height: 20, bgcolor: 'currentColor', borderRadius: '50%' }} />
              </IconButton>
            </Tooltip>
          </Popover>

          {/* Arrow with arrowhead style submenu */}
          <Tooltip title="Arrow / Line">
            <IconButton
              onClick={(e) => setArrowAnchor(arrowAnchor ? null : e.currentTarget)}
              sx={{
                color: activeTool === 'arrow' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'arrow' ? 'rgba(255,255,255,0.15)' : 'transparent',
                p: 0.75,
              }}
            >
              <ArrowForwardIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(arrowAnchor)}
            anchorEl={arrowAnchor}
            onClose={() => setArrowAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{ paper: { sx: { bgcolor: 'rgba(0,0,0,0.85)', borderRadius: 1, p: 0.5, mt: 0.5 } } }}
          >
            <Tooltip title="Plain Line (no arrowhead)" placement="right">
              <IconButton
                onClick={() => { setActiveArrowStyle('none'); setActiveTool('arrow'); setArrowAnchor(null) }}
                sx={{ color: activeArrowStyle === 'none' ? '#90caf9' : 'white', display: 'block' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
                </svg>
              </IconButton>
            </Tooltip>
            <Tooltip title="Standard Arrowhead" placement="right">
              <IconButton
                onClick={() => { setActiveArrowStyle('standard'); setActiveTool('arrow'); setArrowAnchor(null) }}
                sx={{ color: activeArrowStyle === 'standard' ? '#90caf9' : 'white', display: 'block' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="2" />
                  <polyline points="14,8 20,12 14,16" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </IconButton>
            </Tooltip>
            <Tooltip title="Triangle Arrowhead" placement="right">
              <IconButton
                onClick={() => { setActiveArrowStyle('triangle'); setActiveTool('arrow'); setArrowAnchor(null) }}
                sx={{ color: activeArrowStyle === 'triangle' ? '#90caf9' : 'white', display: 'block' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <line x1="4" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="2" />
                  <polygon points="14,7 22,12 14,17" fill="currentColor" />
                </svg>
              </IconButton>
            </Tooltip>
            <Tooltip title="Circle Arrowhead" placement="right">
              <IconButton
                onClick={() => { setActiveArrowStyle('circle'); setActiveTool('arrow'); setArrowAnchor(null) }}
                sx={{ color: activeArrowStyle === 'circle' ? '#90caf9' : 'white', display: 'block' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <line x1="4" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="2" />
                  <circle cx="19" cy="12" r="4" fill="currentColor" />
                </svg>
              </IconButton>
            </Tooltip>
          </Popover>

          {/* Text */}
          <Tooltip title="Add Text">
            <IconButton
              onClick={() => {
                setActiveTool('text')
                handleAddText()
              }}
              sx={{ color: 'white', p: 0.75 }}
            >
              <TextFieldsIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>

          {/* Link */}
          <Tooltip title="Add Hyperlink">
            <IconButton
              onClick={() => {
                setActiveTool('link')
                handleAddLink()
              }}
              sx={{ color: 'white', p: 0.75 }}
            >
              <LinkIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Line thickness */}
          <Tooltip title="Line Thickness">
            <IconButton
              onClick={(e) => setLineWidthAnchor(lineWidthAnchor ? null : e.currentTarget)}
              sx={{ color: 'white', p: 0.75 }}
            >
              <LineWeightIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(lineWidthAnchor)}
            anchorEl={lineWidthAnchor}
            onClose={() => setLineWidthAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: 'rgba(0,0,0,0.85)',
                  borderRadius: 1,
                  p: 0.75,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  alignItems: 'center',
                  mt: 0.5,
                },
              },
            }}
          >
            {LINE_WIDTHS.map((lw) => (
              <Tooltip key={lw} title={`${lw}px`} placement="right">
                <Box
                  onClick={() => handleLineWidthChange(lw)}
                  sx={{
                    width: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    py: 0.5,
                    cursor: 'pointer',
                    borderRadius: 0.5,
                    bgcolor: activeLineWidth === lw ? 'rgba(255,255,255,0.15)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
                  }}
                >
                  <Box
                    sx={{
                      width: 24,
                      height: Math.max(2, lw),
                      bgcolor: 'white',
                      borderRadius: lw > 2 ? '1px' : 0,
                    }}
                  />
                </Box>
              </Tooltip>
            ))}
          </Popover>

          {/* Color picker */}
          <Tooltip title="Color">
            <IconButton
              onClick={(e) => setColorPickerAnchor(colorPickerAnchor ? null : e.currentTarget)}
              sx={{ color: 'white', p: 0.75 }}
            >
              <PaletteIcon sx={{ fontSize: 28, color: activeColor === '#000000' ? 'white' : activeColor }} />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(colorPickerAnchor)}
            anchorEl={colorPickerAnchor}
            onClose={() => setColorPickerAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: 'rgba(0,0,0,0.85)',
                  borderRadius: 1,
                  p: 0.75,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  alignItems: 'center',
                  mt: 0.5,
                },
              },
            }}
          >
            {PALETTE.map((c) => (
              <Tooltip key={c} title={c} placement="right">
                <Box
                  onClick={() => handleColorChange(c)}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    bgcolor: c,
                    border: activeColor === c ? '2px solid #90caf9' : '1px solid rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    '&:hover': { transform: 'scale(1.2)' },
                    transition: 'transform 0.15s',
                    flexShrink: 0,
                  }}
                />
              </Tooltip>
            ))}
          </Popover>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Delete selected */}
          <Tooltip title="Delete Selected">
            <IconButton onClick={handleDeleteSelected} sx={{ color: 'white', p: 0.75 }}>
              <DeleteIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>

          {/* Clear all */}
          <Tooltip title="Clear All Annotations">
            <IconButton onClick={handleClearAll} sx={{ color: '#ef5350', p: 0.75 }}>
              <DeleteSweepIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Done */}
          <Tooltip title="Save & Exit Edit Mode">
            <IconButton onClick={handleDone} sx={{ color: '#66bb6a', p: 0.75 }}>
              <CheckIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Edit-mode label */}
      {editMode && (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            bottom: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            color: 'white',
            bgcolor: 'rgba(0,0,0,0.6)',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            userSelect: 'none',
          }}
        >
          Canvas Edit Mode — Image navigation disabled (Esc to deselect)
        </Typography>
      )}

      {/* Link dialog */}
      <Dialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ backdrop: { style: { backgroundColor: 'transparent' } } }}
      >
        <DialogTitle>Add Hyperlink</DialogTitle>
        <DialogContent>
          <TextField
            label="Display Text"
            fullWidth
            size="small"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            label="URL"
            fullWidth
            size="small"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleLinkConfirm} disabled={!linkUrl}>
            Add Link
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
