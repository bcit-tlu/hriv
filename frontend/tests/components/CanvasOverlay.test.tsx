/**
 * Minimal frontend test suite for the CanvasOverlay component.
 *
 * Context: Devin Review finding ANALYSIS_0005 flagged the fabric canvas
 * re-initialization when emitAnnotations dependency changes, and the overall
 * lack of automated tests for the canvas overlay feature.  These tests cover:
 *
 * 1. Link URL sanitization — only http/https rendered as clickable anchors
 * 2. View-mode rendering with and without annotations
 * 3. Edit-mode toolbar visibility
 * 4. CanvasAnnotation type contract (shape of serialised annotations)
 * 5. Component returns null when not editing and no annotations present
 *
 * Heavy browser-only dependencies (fabric.js, OpenSeadragon) are mocked so
 * the suite runs in jsdom without a real canvas.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { CanvasAnnotation } from '../../src/components/CanvasOverlay'

// ---------------------------------------------------------------------------
// Mocks — fabric.js and OpenSeadragon rely on native canvas / WebGL, so we
// stub them out at the module level before importing the component.
// We use `function` (not arrow functions) so they are constructable via `new`.
// ---------------------------------------------------------------------------

vi.mock('fabric', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricCanvas(this: any) {
    this.dispose = vi.fn()
    this.add = vi.fn()
    this.renderAll = vi.fn()
    this.getObjects = vi.fn(() => [])
    this.on = vi.fn()
    this.off = vi.fn()
    this.getActiveObject = vi.fn()
    this.getActiveObjects = vi.fn(() => [])
    this.setActiveObject = vi.fn()
    this.discardActiveObject = vi.fn()
    this.forEachObject = vi.fn()
    this.clear = vi.fn()
    this.getScenePoint = vi.fn(() => ({ x: 0, y: 0 }))
    this.remove = vi.fn()
    this.selection = true
    this.defaultCursor = 'default'
    this.hoverCursor = 'default'
    this.width = 800
    this.height = 600
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricRect(this: any) { this.set = vi.fn() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricEllipse(this: any) { this.set = vi.fn() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricLine(this: any) { this.set = vi.fn() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricIText(this: any) { this.set = vi.fn() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricPoint(this: any, x: number, y: number) { this.x = x; this.y = y }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FabricObject(this: any) { this.set = vi.fn() }

  return {
    Canvas: FabricCanvas,
    Rect: FabricRect,
    Ellipse: FabricEllipse,
    Line: FabricLine,
    IText: FabricIText,
    Point: FabricPoint,
    FabricObject: FabricObject,
    util: { transformPoint: vi.fn(() => ({ x: 0, y: 0 })) },
  }
})

vi.mock('openseadragon', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSDPoint(this: any, x: number, y: number) { this.x = x; this.y = y }
  return { default: { Point: OSDPoint }, Point: OSDPoint }
})

// Now import the component (after mocks are registered)
import CanvasOverlay from '../../src/components/CanvasOverlay'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock OpenSeadragon.Viewer for component props */
function mockViewer() {
  return {
    container: { clientWidth: 800, clientHeight: 600 },
    viewport: {
      pixelFromPoint: vi.fn(() => ({ x: 100, y: 100 })),
      pointFromPixel: vi.fn(() => ({ x: 0.1, y: 0.1 })),
      getZoom: vi.fn(() => 1),
    },
    addHandler: vi.fn(),
    removeHandler: vi.fn(),
  } as unknown as Parameters<typeof CanvasOverlay>[0]['viewer']
}

/** Factory for a sample annotation */
function makeAnnotation(overrides: Partial<CanvasAnnotation> = {}): CanvasAnnotation {
  return {
    id: 'test-1',
    type: 'rect',
    vpX: 0.1,
    vpY: 0.1,
    vpWidth: 0.2,
    vpHeight: 0.2,
    color: '#FF0000',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasOverlay', () => {
  let viewer: ReturnType<typeof mockViewer>
  const noop = vi.fn()

  beforeEach(() => {
    viewer = mockViewer()
    vi.clearAllMocks()
    // Flush requestAnimationFrame synchronously so link-box useEffect completes
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
  })

  // ─── Null / empty renders ───────────────────────────────────────────

  describe('returns null when not editing and no annotations', () => {
    it('renders nothing', () => {
      const { container } = render(
        <CanvasOverlay
          viewer={viewer}
          annotations={[]}
          onAnnotationsChange={noop}
          canEdit={false}
          editMode={false}
          onEditModeChange={noop}
        />,
      )
      expect(container.innerHTML).toBe('')
    })
  })

  // ─── View-mode rendering ────────────────────────────────────────────

  describe('view mode', () => {
    it('renders a view canvas when annotations are present', () => {
      const annotations: CanvasAnnotation[] = [makeAnnotation()]
      const { container } = render(
        <CanvasOverlay
          viewer={viewer}
          annotations={annotations}
          onAnnotationsChange={noop}
          canEdit={false}
          editMode={false}
          onEditModeChange={noop}
        />,
      )
      const canvas = container.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
    })

    it('does not show the edit toolbar in view mode', () => {
      const annotations: CanvasAnnotation[] = [makeAnnotation()]
      render(
        <CanvasOverlay
          viewer={viewer}
          annotations={annotations}
          onAnnotationsChange={noop}
          canEdit={true}
          editMode={false}
          onEditModeChange={noop}
        />,
      )
      expect(screen.queryByLabelText('Save & Exit Edit Mode')).not.toBeInTheDocument()
    })
  })

  // ─── Edit-mode rendering ────────────────────────────────────────────

  describe('edit mode', () => {
    it('renders the floating toolbar with expected buttons', () => {
      render(
        <CanvasOverlay
          viewer={viewer}
          annotations={[]}
          onAnnotationsChange={noop}
          canEdit={true}
          editMode={true}
          onEditModeChange={noop}
        />,
      )
      // MUI Tooltip renders aria-label on the button, not a title attribute
      expect(screen.getByLabelText('Rectangle')).toBeInTheDocument()
      expect(screen.getByLabelText('Circle / Ellipse')).toBeInTheDocument()
      expect(screen.getByLabelText(/Arrow/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Text/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Hyperlink|Link/)).toBeInTheDocument()
      expect(screen.getByLabelText('Delete Selected')).toBeInTheDocument()
      expect(screen.getByLabelText('Clear All Annotations')).toBeInTheDocument()
      expect(screen.getByLabelText('Save & Exit Edit Mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Color')).toBeInTheDocument()
      expect(screen.getByLabelText('Line Thickness')).toBeInTheDocument()
    })

    it('shows the edit-mode info label', () => {
      render(
        <CanvasOverlay
          viewer={viewer}
          annotations={[]}
          onAnnotationsChange={noop}
          canEdit={true}
          editMode={true}
          onEditModeChange={noop}
        />,
      )
      expect(screen.getByText(/Canvas Edit Mode/)).toBeInTheDocument()
    })

    it('renders a canvas element for fabric.js', () => {
      const { container } = render(
        <CanvasOverlay
          viewer={viewer}
          annotations={[]}
          onAnnotationsChange={noop}
          canEdit={true}
          editMode={true}
          onEditModeChange={noop}
        />,
      )
      const canvases = container.querySelectorAll('canvas')
      expect(canvases.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── Link URL sanitization (XSS prevention) ────────────────────────

  describe('link URL sanitization', () => {
    /**
     * The component computes link boxes inside a useEffect + requestAnimationFrame.
     * We flush both synchronously via our rAF mock and act().
     * pixelFromPoint is called twice per link (topLeft, bottomRight) so we
     * alternate return values to produce non-zero-size hit areas.
     */
    function renderWithLinks(annotations: CanvasAnnotation[]) {
      let callCount = 0
      ;(viewer.viewport.pixelFromPoint as Mock).mockImplementation(() => {
        callCount++
        return callCount % 2 === 1 ? { x: 10, y: 10 } : { x: 110, y: 40 }
      })
      let result: ReturnType<typeof render>
      act(() => {
        result = render(
          <CanvasOverlay
            viewer={viewer}
            annotations={annotations}
            onAnnotationsChange={noop}
            canEdit={false}
            editMode={false}
            onEditModeChange={noop}
          />,
        )
      })
      return result!
    }

    it('renders an anchor for https:// link annotations in view mode', () => {
      const { container } = renderWithLinks([
        makeAnnotation({
          id: 'link-safe',
          type: 'link',
          text: 'Safe Link',
          url: 'https://example.com',
          vpFontSize: 0.02,
        }),
      ])
      const anchor = container.querySelector('a[href="https://example.com"]')
      expect(anchor).toBeInTheDocument()
      expect(anchor?.getAttribute('target')).toBe('_blank')
      expect(anchor?.getAttribute('rel')).toContain('noopener')
    })

    it('renders an anchor for http:// link annotations in view mode', () => {
      const { container } = renderWithLinks([
        makeAnnotation({
          id: 'link-http',
          type: 'link',
          text: 'HTTP Link',
          url: 'http://example.com',
          vpFontSize: 0.02,
        }),
      ])
      const anchor = container.querySelector('a[href="http://example.com"]')
      expect(anchor).toBeInTheDocument()
    })

    it('does NOT render an anchor for javascript: protocol links', () => {
      const { container } = renderWithLinks([
        makeAnnotation({
          id: 'link-xss',
          type: 'link',
          text: 'XSS Link',
          url: 'javascript:alert(1)',
          vpFontSize: 0.02,
        }),
      ])
      const anchor = container.querySelector('a')
      expect(anchor).not.toBeInTheDocument()
    })

    it('does NOT render an anchor for data: protocol links', () => {
      const { container } = renderWithLinks([
        makeAnnotation({
          id: 'link-data',
          type: 'link',
          text: 'Data Link',
          url: 'data:text/html,<script>alert(1)</script>',
          vpFontSize: 0.02,
        }),
      ])
      const anchor = container.querySelector('a')
      expect(anchor).not.toBeInTheDocument()
    })

    it('does NOT render an anchor for empty URL', () => {
      const { container } = renderWithLinks([
        makeAnnotation({
          id: 'link-empty',
          type: 'link',
          text: 'Empty Link',
          url: '',
          vpFontSize: 0.02,
        }),
      ])
      const anchor = container.querySelector('a')
      expect(anchor).not.toBeInTheDocument()
    })

    it('renders only safe links among mixed annotations', () => {
      const { container } = renderWithLinks([
        makeAnnotation({ id: 'r1', type: 'rect' }),
        makeAnnotation({ id: 'c1', type: 'circle' }),
        makeAnnotation({
          id: 'l1',
          type: 'link',
          text: 'Example',
          url: 'https://example.com',
          vpFontSize: 0.02,
        }),
        makeAnnotation({
          id: 'l2',
          type: 'link',
          text: 'Blocked',
          url: 'javascript:void(0)',
          vpFontSize: 0.02,
        }),
      ])
      const anchors = container.querySelectorAll('a')
      expect(anchors).toHaveLength(1)
      expect(anchors[0].getAttribute('href')).toBe('https://example.com')
    })
  })

  // ─── CanvasAnnotation type contract ─────────────────────────────────

  describe('CanvasAnnotation type contract', () => {
    it('accepts all required fields for a rect annotation', () => {
      const ann: CanvasAnnotation = {
        id: 'r1',
        type: 'rect',
        vpX: 0,
        vpY: 0,
        vpWidth: 1,
        vpHeight: 1,
        color: '#000',
      }
      expect(ann.type).toBe('rect')
      expect(ann.filled).toBeUndefined()
    })

    it('accepts optional fields for an arrow annotation', () => {
      const ann: CanvasAnnotation = {
        id: 'a1',
        type: 'arrow',
        vpX: 0,
        vpY: 0,
        vpWidth: 0,
        vpHeight: 0,
        color: '#000',
        vpX2: 1,
        vpY2: 1,
        arrowStyle: 'triangle',
        strokeWidth: 4,
      }
      expect(ann.arrowStyle).toBe('triangle')
      expect(ann.vpX2).toBe(1)
    })

    it('accepts optional fields for a link annotation', () => {
      const ann: CanvasAnnotation = {
        id: 'l1',
        type: 'link',
        vpX: 0,
        vpY: 0,
        vpWidth: 0.3,
        vpHeight: 0.05,
        color: '#2196F3',
        text: 'Click me',
        url: 'https://example.com',
        vpFontSize: 0.02,
      }
      expect(ann.url).toBe('https://example.com')
      expect(ann.text).toBe('Click me')
    })

    it('supports the filled property for shapes', () => {
      const ann: CanvasAnnotation = {
        id: 'c1',
        type: 'circle',
        vpX: 0,
        vpY: 0,
        vpWidth: 0.5,
        vpHeight: 0.5,
        color: '#4CAF50',
        filled: true,
      }
      expect(ann.filled).toBe(true)
    })

    it('accepts all five annotation types', () => {
      const types: CanvasAnnotation['type'][] = ['rect', 'circle', 'arrow', 'text', 'link']
      for (const t of types) {
        const ann: CanvasAnnotation = {
          id: `type-${t}`,
          type: t,
          vpX: 0,
          vpY: 0,
          vpWidth: 0.1,
          vpHeight: 0.1,
          color: '#000',
        }
        expect(ann.type).toBe(t)
      }
    })

    it('supports the rotation property for rect annotations', () => {
      const ann: CanvasAnnotation = {
        id: 'rot-rect',
        type: 'rect',
        vpX: 0.1,
        vpY: 0.1,
        vpWidth: 0.2,
        vpHeight: 0.1,
        color: '#FF0000',
        rotation: 45,
      }
      expect(ann.rotation).toBe(45)
    })

    it('supports the rotation property for circle annotations', () => {
      const ann: CanvasAnnotation = {
        id: 'rot-circle',
        type: 'circle',
        vpX: 0.2,
        vpY: 0.2,
        vpWidth: 0.1,
        vpHeight: 0.2,
        color: '#00FF00',
        rotation: 30,
      }
      expect(ann.rotation).toBe(30)
      // Elliptical: vpWidth !== vpHeight
      expect(ann.vpWidth).not.toBe(ann.vpHeight)
    })

    it('supports the rotation property for text annotations', () => {
      const ann: CanvasAnnotation = {
        id: 'rot-text',
        type: 'text',
        vpX: 0.1,
        vpY: 0.1,
        vpWidth: 0.3,
        vpHeight: 0.05,
        color: '#0000FF',
        text: 'Rotated',
        rotation: 90,
      }
      expect(ann.rotation).toBe(90)
    })

    it('defaults rotation to undefined when not set', () => {
      const ann: CanvasAnnotation = {
        id: 'no-rot',
        type: 'rect',
        vpX: 0,
        vpY: 0,
        vpWidth: 0.1,
        vpHeight: 0.1,
        color: '#000',
      }
      expect(ann.rotation).toBeUndefined()
    })

    it('supports elliptical dimensions (vpWidth !== vpHeight) on circle type', () => {
      const ann: CanvasAnnotation = {
        id: 'ellipse-1',
        type: 'circle',
        vpX: 0.1,
        vpY: 0.1,
        vpWidth: 0.1,
        vpHeight: 0.2,
        color: '#FF0000',
      }
      expect(ann.type).toBe('circle')
      expect(ann.vpWidth).toBe(0.1)
      expect(ann.vpHeight).toBe(0.2)
      // 2:1 aspect ratio — this is the ellipse case from side-handle resize
      expect(ann.vpHeight / ann.vpWidth).toBe(2)
    })
  })

  // ─── View-mode rotation rendering ──────────────────────────────────

  describe('view-mode rotation rendering', () => {
    /**
     * Render the component in view mode with given annotations, then
     * return the spied canvas 2D context so we can assert on draw calls.
     *
     * We spy on getContext to capture method calls made by redrawViewCanvas.
     * pixelFromPoint is called for topLeft and bottomRight per annotation,
     * so we alternate return values.
     */
    function renderAndCaptureCalls(annotations: CanvasAnnotation[]) {
      // Track all calls to canvas context methods
      const calls: { method: string; args: unknown[] }[] = []
      const realGetContext = HTMLCanvasElement.prototype.getContext

      const ctxProxy = new Proxy({} as CanvasRenderingContext2D, {
        get(_target, prop: string) {
          if (prop === 'canvas') return { width: 800, height: 600 }
          // Return a function that records the call
          return (...args: unknown[]) => {
            calls.push({ method: prop, args })
            // measureText needs to return an object
            if (prop === 'measureText') return { width: 50 }
            return undefined
          }
        },
      })

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function (this: HTMLCanvasElement, contextId: string, ...rest: any[]) {
          // Return our proxy for the view canvas (non-fabric canvas)
          // Fabric canvas is mocked at module level and won't call this
          if (contextId === '2d') return ctxProxy as unknown as CanvasRenderingContext2D
          return realGetContext.call(this, contextId, ...rest)
        },
      )

      let callCount = 0
      ;(viewer.viewport.pixelFromPoint as Mock).mockImplementation(() => {
        callCount++
        // Alternate: odd calls = topLeft, even calls = bottomRight
        return callCount % 2 === 1 ? { x: 100, y: 100 } : { x: 300, y: 200 }
      })

      act(() => {
        render(
          <CanvasOverlay
            viewer={viewer}
            annotations={annotations}
            onAnnotationsChange={noop}
            canEdit={false}
            editMode={false}
            onEditModeChange={noop}
          />,
        )
      })

      return calls
    }

    it('applies save/translate/rotate/restore for a rotated rect', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({ type: 'rect', rotation: 45 }),
      ])

      const saveIdx = calls.findIndex(c => c.method === 'save')
      const translateIdx = calls.findIndex(c => c.method === 'translate')
      const rotateIdx = calls.findIndex(c => c.method === 'rotate')
      const restoreIdx = calls.findIndex(c => c.method === 'restore')

      expect(saveIdx).toBeGreaterThanOrEqual(0)
      expect(translateIdx).toBeGreaterThan(saveIdx)
      expect(rotateIdx).toBeGreaterThan(translateIdx)
      expect(restoreIdx).toBeGreaterThan(rotateIdx)

      // Verify translate uses origin (topLeft), not center
      const translateCall = calls[translateIdx]
      expect(translateCall.args).toEqual([100, 100]) // topLeft.x, topLeft.y

      // Verify rotate receives 45° in radians
      const rotateCall = calls[rotateIdx]
      expect(rotateCall.args[0]).toBeCloseTo((45 * Math.PI) / 180, 5)
    })

    it('does not call rotate for a rect with no rotation', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({ type: 'rect' }), // no rotation field
      ])

      const rotateCalls = calls.filter(c => c.method === 'rotate')
      expect(rotateCalls).toHaveLength(0)
    })

    it('applies save/translate/rotate for a rotated ellipse', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({
          type: 'circle',
          vpWidth: 0.1,
          vpHeight: 0.2,
          rotation: 30,
        }),
      ])

      const saveIdx = calls.findIndex(c => c.method === 'save')
      const translateIdx = calls.findIndex(c => c.method === 'translate')
      const rotateIdx = calls.findIndex(c => c.method === 'rotate')
      const ellipseIdx = calls.findIndex(c => c.method === 'ellipse')
      const restoreIdx = calls.findIndex(c => c.method === 'restore')

      expect(saveIdx).toBeGreaterThanOrEqual(0)
      expect(translateIdx).toBeGreaterThan(saveIdx)
      expect(rotateIdx).toBeGreaterThan(translateIdx)
      expect(ellipseIdx).toBeGreaterThan(rotateIdx)
      expect(restoreIdx).toBeGreaterThan(ellipseIdx)

      // Verify translate uses origin (topLeft)
      expect(calls[translateIdx].args).toEqual([100, 100])

      // Verify rotate receives 30° in radians
      expect(calls[rotateIdx].args[0]).toBeCloseTo((30 * Math.PI) / 180, 5)

      // Verify ellipse rotation parameter is 0 (rotation handled by ctx.rotate)
      const ellipseCall = calls[ellipseIdx]
      // ctx.ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle)
      expect(ellipseCall.args[4]).toBe(0) // rotation param should be 0
    })

    it('renders ellipse with non-uniform radii from viewport dimensions', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({
          type: 'circle',
          vpWidth: 0.1,
          vpHeight: 0.2,
        }),
      ])

      const ellipseCall = calls.find(c => c.method === 'ellipse')
      expect(ellipseCall).toBeDefined()
      // pw = 300 - 100 = 200, ph = 200 - 100 = 100
      // cx = pw/2 = 100, cy = ph/2 = 50, rx = |pw/2| = 100, ry = |ph/2| = 50
      // (based on our mocked pixelFromPoint returning (100,100) and (300,200))
      const [, , rx, ry] = ellipseCall!.args as number[]
      expect(rx).not.toBe(ry) // non-uniform = ellipse, not circle
    })

    it('applies save/translate/rotate for rotated text', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({
          type: 'text',
          text: 'Hello',
          vpFontSize: 0.02,
          rotation: 90,
        }),
      ])

      const saveIdx = calls.findIndex(c => c.method === 'save')
      const translateIdx = calls.findIndex(c => c.method === 'translate')
      const rotateIdx = calls.findIndex(c => c.method === 'rotate')
      const fillTextIdx = calls.findIndex(c => c.method === 'fillText')
      const restoreIdx = calls.findIndex(c => c.method === 'restore')

      expect(saveIdx).toBeGreaterThanOrEqual(0)
      expect(translateIdx).toBeGreaterThan(saveIdx)
      expect(rotateIdx).toBeGreaterThan(translateIdx)
      expect(fillTextIdx).toBeGreaterThan(rotateIdx)
      expect(restoreIdx).toBeGreaterThan(fillTextIdx)

      // Verify translate uses origin (topLeft)
      expect(calls[translateIdx].args).toEqual([100, 100])

      // Verify rotate receives 90° in radians
      expect(calls[rotateIdx].args[0]).toBeCloseTo((90 * Math.PI) / 180, 5)

      // Verify fillText draws at local origin (0, fontSize), not offset from center
      const fillTextCall = calls[fillTextIdx]
      expect(fillTextCall.args[1]).toBe(0) // x = 0 (origin-based)
    })

    it('renders arrow with moveTo/lineTo from start to end point', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({
          type: 'arrow',
          vpX2: 0.5,
          vpY2: 0.5,
        }),
      ])

      const moveToIdx = calls.findIndex(c => c.method === 'moveTo')
      const lineToIdx = calls.findIndex(c => c.method === 'lineTo')
      const strokeIdx = calls.findIndex(c => c.method === 'stroke')

      expect(moveToIdx).toBeGreaterThanOrEqual(0)
      expect(lineToIdx).toBeGreaterThan(moveToIdx)
      expect(strokeIdx).toBeGreaterThan(lineToIdx)

      // Verify start point = first pixelFromPoint call (100, 100)
      expect(calls[moveToIdx].args).toEqual([100, 100])
      // Verify end point = second pixelFromPoint call (300, 200)
      expect(calls[lineToIdx].args).toEqual([300, 200])
    })

    it('applies save/translate/rotate for rotated link with underline', () => {
      const calls = renderAndCaptureCalls([
        makeAnnotation({
          type: 'link',
          text: 'Example',
          url: 'https://example.com',
          vpFontSize: 0.02,
          rotation: 60,
        }),
      ])

      const rotateIdx = calls.findIndex(c => c.method === 'rotate')
      expect(rotateIdx).toBeGreaterThanOrEqual(0)
      expect(calls[rotateIdx].args[0]).toBeCloseTo((60 * Math.PI) / 180, 5)

      // Verify underline moveTo starts at x=0 (origin-based)
      const moveToCall = calls.find(c => c.method === 'moveTo')
      expect(moveToCall).toBeDefined()
      expect(moveToCall!.args[0]).toBe(0) // x = 0
    })
  })
})
