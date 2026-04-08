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

// MUI Icons
import CropSquareIcon from '@mui/icons-material/CropSquare'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import LinkIcon from '@mui/icons-material/Link'
import DeleteIcon from '@mui/icons-material/Delete'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import CheckIcon from '@mui/icons-material/Check'
import NearMeIcon from '@mui/icons-material/NearMe'

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
}

const PALETTE = [
  '#FF0000', // Red
  '#2196F3', // Blue
  '#4CAF50', // Green
  '#FFEB3B', // Yellow
  '#FF9800', // Orange
  '#9C27B0', // Purple
  '#000000', // Black
  '#FFFFFF', // White
]

type Tool = 'select' | 'rect' | 'circle' | 'arrow' | 'text' | 'link'

interface CanvasOverlayProps {
  viewer: OpenSeadragon.Viewer
  annotations: CanvasAnnotation[]
  onAnnotationsChange: (annotations: CanvasAnnotation[]) => void
  canEdit: boolean
  editMode: boolean
  onEditModeChange: (mode: boolean) => void
}

/** Generate a short random ID */
function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Draw a filled arrowhead at the end of a line on a plain canvas context.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number,
  color: string,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export default function CanvasOverlay({
  viewer,
  annotations,
  onAnnotationsChange,
  canEdit: _canEdit,
  editMode,
  onEditModeChange,
}: CanvasOverlayProps) {
  // _canEdit reserved for future per-tool gating; edit button visibility is handled by parent
  void _canEdit
  const viewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const fabricElRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [activeColor, setActiveColor] = useState('#FF0000')
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

  // ─── View mode: render annotations on a plain canvas ──────────
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
        const headLen = Math.max(8, sw * 4)
        drawArrowhead(ctx, topLeft.x, topLeft.y, endPt.x, endPt.y, headLen, ann.color)
        continue
      }

      const bottomRight = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(ann.vpX + ann.vpWidth, ann.vpY + ann.vpHeight),
      )
      const pw = bottomRight.x - topLeft.x
      const ph = bottomRight.y - topLeft.y

      if (ann.type === 'rect') {
        ctx.strokeStyle = ann.color
        const sw = (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()
        ctx.lineWidth = Math.max(1, sw)
        ctx.strokeRect(topLeft.x, topLeft.y, pw, ph)
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
        ctx.strokeStyle = ann.color
        const sw = (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()
        ctx.lineWidth = Math.max(1, sw)
        ctx.stroke()
      } else if (ann.type === 'text' || ann.type === 'link') {
        const vpFontSize = ann.vpFontSize ?? 0.02
        const pxFontSize = Math.abs(vpFontSize * (bottomRight.x - topLeft.x) / (ann.vpWidth || 1))
        const fontSize = Math.max(8, pxFontSize)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = ann.color
        if (ann.type === 'link') {
          ctx.fillStyle = ann.color
          // Underline
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
    // Initial draw
    redrawViewCanvas()
    return () => {
      viewer.removeHandler('animation', handler)
      viewer.removeHandler('animation-finish', handler)
      viewer.removeHandler('resize', handler)
    }
  }, [viewer, editMode, redrawViewCanvas, annotations])

  // ─── Clickable link layer (view mode) ─────────────────────────
  // Render invisible anchor boxes over link annotations
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
    // Defer initial link-box computation to avoid synchronous setState in effect
    const raf = requestAnimationFrame(() => updateLinkBoxes())
    return () => {
      cancelAnimationFrame(raf)
      viewer.removeHandler('animation', handler)
      viewer.removeHandler('animation-finish', handler)
      viewer.removeHandler('resize', handler)
    }
  }, [viewer, editMode, updateLinkBoxes, annotations])

  // ─── Edit mode: fabric.js canvas ──────────────────────────────

  /** Convert viewport annotation → fabric object at current zoom */
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
        ;(line as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = ann.id
        ;(line as fabric.FabricObject & { _annotationType?: string })._annotationType = 'arrow'
        return line
      }

      const bottomRight = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(ann.vpX + ann.vpWidth, ann.vpY + ann.vpHeight),
      )
      const pw = bottomRight.x - topLeft.x
      const ph = bottomRight.y - topLeft.y

      if (ann.type === 'rect') {
        const rect = new fabric.Rect({
          left: topLeft.x,
          top: topLeft.y,
          width: Math.abs(pw),
          height: Math.abs(ph),
          fill: 'transparent',
          stroke: ann.color,
          strokeWidth: Math.max(1, (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()),
          strokeUniform: true,
        })
        ;(rect as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = ann.id
        ;(rect as fabric.FabricObject & { _annotationType?: string })._annotationType = 'rect'
        return rect
      }

      if (ann.type === 'circle') {
        const ellipse = new fabric.Ellipse({
          left: topLeft.x,
          top: topLeft.y,
          rx: Math.abs(pw / 2),
          ry: Math.abs(ph / 2),
          fill: 'transparent',
          stroke: ann.color,
          strokeWidth: Math.max(1, (ann.strokeWidth ?? 2) * viewer.viewport.getZoom()),
          strokeUniform: true,
        })
        ;(ellipse as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = ann.id
        ;(ellipse as fabric.FabricObject & { _annotationType?: string })._annotationType = 'circle'
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
        ;(text as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = ann.id
        ;(text as fabric.FabricObject & { _annotationType?: string })._annotationType = ann.type
        if (ann.type === 'link') {
          ;(text as fabric.FabricObject & { _linkUrl?: string })._linkUrl = ann.url || ''
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

      const id = (obj as fabric.FabricObject & { _annotationId?: string })._annotationId || uid()
      const type = (obj as fabric.FabricObject & { _annotationType?: string })._annotationType as CanvasAnnotation['type'] || 'rect'

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
          color: (obj.stroke as string) || '#FF0000',
          strokeWidth: (obj.strokeWidth ?? 2) / viewer.viewport.getZoom(),
        }
      }

      // Get the bounding rect considering transforms
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
        color: (obj.stroke as string) || (obj.fill as string) || '#FF0000',
        strokeWidth: (obj.strokeWidth ?? 2) / viewer.viewport.getZoom(),
      }

      if (type === 'text' || type === 'link') {
        const textObj = obj as fabric.IText
        base.text = textObj.text || ''
        base.color = (textObj.fill as string) || '#FF0000'
        base.vpFontSize = (textObj.fontSize ?? 16) / viewer.viewport.getZoom()
        if (type === 'link') {
          base.url = (obj as fabric.FabricObject & { _linkUrl?: string })._linkUrl || ''
        }
      }

      return base
    },
    [viewer],
  )

  /** Collect all fabric objects → annotations and emit change */
  const emitAnnotations = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    const objs = fc.getObjects()
    const result: CanvasAnnotation[] = []
    for (const obj of objs) {
      const ann = fabricToAnnotation(obj)
      if (ann) result.push(ann)
    }
    onAnnotationsChange(result)
  }, [fabricToAnnotation, onAnnotationsChange])

  // Initialize / teardown fabric canvas when entering/exiting edit mode
  useEffect(() => {
    if (!editMode) {
      // Teardown
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }
      return
    }

    // Setup fabric canvas
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

    // Load existing annotations as fabric objects
    for (const ann of annotationsRef.current) {
      const obj = annotationToFabric(ann)
      if (obj) fc.add(obj)
    }
    fc.renderAll()

    // Listen for delete keystrokes
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't intercept keystrokes when an IText is in editing mode
        const activeObj = fc.getActiveObject()
        if (activeObj && activeObj instanceof fabric.IText && activeObj.isEditing) return
        const active = fc.getActiveObjects()
        if (active.length > 0) {
          for (const obj of active) {
            fc.remove(obj)
          }
          fc.discardActiveObject()
          fc.renderAll()
          emitAnnotations()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Collect annotations before disposing
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }
    }
  }, [editMode, viewer, annotationToFabric, emitAnnotations])

  // ─── Drawing handlers for edit mode ───────────────────────────

  useEffect(() => {
    const fc = fabricCanvasRef.current
    if (!fc || !editMode) return

    // Update selection mode based on tool
    fc.selection = activeTool === 'select'
    fc.forEachObject((obj) => {
      obj.selectable = activeTool === 'select'
      obj.evented = activeTool === 'select'
    })
    fc.renderAll()

    if (activeTool === 'select') {
      // Re-enable default fabric behavior
      fc.defaultCursor = 'default'
      fc.hoverCursor = 'move'
      return
    }

    fc.defaultCursor = 'crosshair'
    fc.hoverCursor = 'crosshair'

    const handleMouseDown = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      if (activeTool === 'text' || activeTool === 'link') return // handled separately
      isDrawingRef.current = true
      const pointer = fc.getScenePoint(opt.e)
      drawStartRef.current = { x: pointer.x, y: pointer.y }

      if (activeTool === 'rect') {
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: activeColor,
          strokeWidth: 2,
          strokeUniform: true,
          selectable: false,
          evented: false,
        })
        ;(rect as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = uid()
        ;(rect as fabric.FabricObject & { _annotationType?: string })._annotationType = 'rect'
        fc.add(rect)
        drawObjRef.current = rect
      } else if (activeTool === 'circle') {
        const ellipse = new fabric.Ellipse({
          left: pointer.x,
          top: pointer.y,
          rx: 0,
          ry: 0,
          fill: 'transparent',
          stroke: activeColor,
          strokeWidth: 2,
          strokeUniform: true,
          selectable: false,
          evented: false,
        })
        ;(ellipse as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = uid()
        ;(ellipse as fabric.FabricObject & { _annotationType?: string })._annotationType = 'circle'
        fc.add(ellipse)
        drawObjRef.current = ellipse
      } else if (activeTool === 'arrow') {
        const line = new fabric.Line(
          [pointer.x, pointer.y, pointer.x, pointer.y],
          {
            stroke: activeColor,
            strokeWidth: 2,
            selectable: false,
            evented: false,
          },
        )
        ;(line as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = uid()
        ;(line as fabric.FabricObject & { _annotationType?: string })._annotationType = 'arrow'
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
      isDrawingRef.current = false
      const obj = drawObjRef.current
      if (obj) {
        obj.set({ selectable: true, evented: true })
        obj.setCoords()
      }
      drawStartRef.current = null
      drawObjRef.current = null
      emitAnnotations()
      // Switch back to select tool after drawing
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
  }, [editMode, activeTool, activeColor, emitAnnotations])

  // Emit on object modified (move/resize)
  useEffect(() => {
    const fc = fabricCanvasRef.current
    if (!fc || !editMode) return
    const handler = () => emitAnnotations()
    fc.on('object:modified', handler)
    return () => {
      fc.off('object:modified', handler)
    }
  }, [editMode, emitAnnotations])

  // ─── Tool actions ─────────────────────────────────────────────

  const handleAddText = useCallback(() => {
    const fc = fabricCanvasRef.current
    if (!fc) return
    const center = { x: fc.width! / 2, y: fc.height! / 2 }
    const text = new fabric.IText('Text', {
      left: center.x - 30,
      top: center.y - 10,
      fontFamily: 'sans-serif',
      fontSize: 20,
      fill: activeColor,
    })
    ;(text as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = uid()
    ;(text as fabric.FabricObject & { _annotationType?: string })._annotationType = 'text'
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
      left: center.x - 40,
      top: center.y - 10,
      fontFamily: 'sans-serif',
      fontSize: 20,
      fill: activeColor,
      underline: true,
    })
    ;(text as fabric.FabricObject & { _annotationId?: string; _annotationType?: string })._annotationId = uid()
    ;(text as fabric.FabricObject & { _annotationType?: string })._annotationType = 'link'
    ;(text as fabric.FabricObject & { _linkUrl?: string })._linkUrl = linkUrl
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
    emitAnnotations()
    onEditModeChange(false)
  }, [emitAnnotations, onEditModeChange])

  // Don't render anything if no annotations and not in edit mode
  if (!editMode && annotations.length === 0) return null

  return (
    <>
      {/* View-mode canvas (static rendering, pointer-events: none) */}
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
          {/* Clickable link overlays */}
          {linkBoxes.map((lb) => {
            // Only allow http/https URLs to prevent javascript: XSS
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
          {/* Select tool */}
          <Tooltip title="Select / Move">
            <IconButton
              size="small"
              onClick={() => setActiveTool('select')}
              sx={{
                color: activeTool === 'select' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'select' ? 'rgba(255,255,255,0.15)' : 'transparent',
              }}
            >
              <NearMeIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Rectangle */}
          <Tooltip title="Rectangle">
            <IconButton
              size="small"
              onClick={() => setActiveTool('rect')}
              sx={{
                color: activeTool === 'rect' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'rect' ? 'rgba(255,255,255,0.15)' : 'transparent',
              }}
            >
              <CropSquareIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Circle */}
          <Tooltip title="Circle / Ellipse">
            <IconButton
              size="small"
              onClick={() => setActiveTool('circle')}
              sx={{
                color: activeTool === 'circle' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'circle' ? 'rgba(255,255,255,0.15)' : 'transparent',
              }}
            >
              <CircleOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Arrow */}
          <Tooltip title="Arrow">
            <IconButton
              size="small"
              onClick={() => setActiveTool('arrow')}
              sx={{
                color: activeTool === 'arrow' ? '#90caf9' : 'white',
                bgcolor: activeTool === 'arrow' ? 'rgba(255,255,255,0.15)' : 'transparent',
              }}
            >
              <ArrowForwardIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Text */}
          <Tooltip title="Add Text">
            <IconButton
              size="small"
              onClick={() => {
                setActiveTool('text')
                handleAddText()
              }}
              sx={{ color: 'white' }}
            >
              <TextFieldsIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Link */}
          <Tooltip title="Add Hyperlink">
            <IconButton
              size="small"
              onClick={() => {
                setActiveTool('link')
                handleAddLink()
              }}
              sx={{ color: 'white' }}
            >
              <LinkIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Color picker */}
          <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center', mx: 0.5 }}>
            {PALETTE.map((c) => (
              <Tooltip key={c} title={c}>
                <Box
                  onClick={() => setActiveColor(c)}
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    bgcolor: c,
                    border: activeColor === c ? '2px solid #90caf9' : '1px solid rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    '&:hover': { transform: 'scale(1.2)' },
                    transition: 'transform 0.15s',
                  }}
                />
              </Tooltip>
            ))}
          </Box>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Delete selected */}
          <Tooltip title="Delete Selected">
            <IconButton size="small" onClick={handleDeleteSelected} sx={{ color: 'white' }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Clear all */}
          <Tooltip title="Clear All Annotations">
            <IconButton size="small" onClick={handleClearAll} sx={{ color: '#ef5350' }}>
              <DeleteSweepIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

          {/* Done */}
          <Tooltip title="Save & Exit Edit Mode">
            <IconButton size="small" onClick={handleDone} sx={{ color: '#66bb6a' }}>
              <CheckIcon fontSize="small" />
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
          Canvas Edit Mode — Image navigation disabled
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
