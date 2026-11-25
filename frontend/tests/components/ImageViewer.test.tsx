/**
 * Tests for the ImageViewer component.
 *
 * OpenSeadragon requires a real canvas/WebGL, so the whole module is mocked
 * with a recording fake: the viewer captures event handlers, controls, and
 * overlays; Button and MouseTracker capture their handler options so tests
 * can drive toolbar clicks and selection-rectangle gestures directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { AuthContext } from '../../src/authContextValue'
import { BOARD_AUTH } from '../../src/components/boardsFixtures'
import { cleanup, render, screen, act, fireEvent, waitFor, within } from '@testing-library/react'

const hadFullscreenElementOwnProperty = Object.prototype.hasOwnProperty.call(
  document,
  'fullscreenElement',
)
const originalFullscreenElementDescriptor =
  Object.getOwnPropertyDescriptor(document, 'fullscreenElement') ??
  Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement')
const hadExitFullscreenOwnProperty = Object.prototype.hasOwnProperty.call(
  document,
  'exitFullscreen',
)
const originalExitFullscreenDescriptor =
  Object.getOwnPropertyDescriptor(document, 'exitFullscreen') ??
  Object.getOwnPropertyDescriptor(Document.prototype, 'exitFullscreen')

interface MockButton {
  options: {
    tooltip: string
    onClick: () => void
  }
  element: HTMLDivElement
}

interface MockTrackerOptions {
  clickHandler: (event: { quick: boolean; position?: { x: number; y: number } }) => void
  pressHandler: (event: { position?: { x: number; y: number } }) => void
  dragHandler: (event: {
    position?: { x: number; y: number }
    originalEvent?: { shiftKey?: boolean }
  }) => void
  releaseHandler: () => void
  moveHandler?: (event: { position?: { x: number; y: number } }) => void
  leaveHandler?: () => void
  preProcessEventHandler?: (event: {
    eventType?: string
    originalEvent?: { target?: EventTarget | null }
    preventGesture: boolean
    preventDefault?: boolean
  }) => void
}

interface MockViewportState {
  current: {
    zoom: number
    center: { x: number; y: number }
    rotation: number
  }
  target: {
    zoom: number
    center: { x: number; y: number }
    rotation: number
  }
}

interface MockViewer {
  element: HTMLDivElement
  container: HTMLDivElement
  canvas: HTMLDivElement
  navigator: { element: HTMLDivElement }
  world: { getItemAt: ReturnType<typeof vi.fn> }
  viewportState: MockViewportState
  viewport: {
    getZoom: ReturnType<typeof vi.fn>
    getCenter: ReturnType<typeof vi.fn>
    getRotation: ReturnType<typeof vi.fn>
    getHomeZoom: ReturnType<typeof vi.fn>
    getHomeBounds: ReturnType<typeof vi.fn>
    getFlip: ReturnType<typeof vi.fn>
    setRotation: ReturnType<typeof vi.fn>
    rotateTo: ReturnType<typeof vi.fn>
    zoomTo: ReturnType<typeof vi.fn>
    panTo: ReturnType<typeof vi.fn>
    fitBounds: ReturnType<typeof vi.fn>
    goHome: ReturnType<typeof vi.fn>
    pixelFromPoint: ReturnType<typeof vi.fn>
    pointFromPixel: ReturnType<typeof vi.fn>
    viewportToImageZoom: ReturnType<typeof vi.fn>
    viewportToImageRectangle: ReturnType<typeof vi.fn>
    viewportToViewerElementCoordinates: ReturnType<typeof vi.fn>
    imageToViewerElementCoordinates: ReturnType<typeof vi.fn>
  }
  addHandler: ReturnType<typeof vi.fn>
  addOnceHandler: ReturnType<typeof vi.fn>
  addControl: ReturnType<typeof vi.fn>
  removeControl: ReturnType<typeof vi.fn>
  setControlsEnabled: ReturnType<typeof vi.fn>
  addOverlay: ReturnType<typeof vi.fn>
  updateOverlay: ReturnType<typeof vi.fn>
  removeOverlay: ReturnType<typeof vi.fn>
  setMouseNavEnabled: ReturnType<typeof vi.fn>
  isFullPage: ReturnType<typeof vi.fn>
  fullPageButton: MockButton
  zoomInButton: MockButton
  zoomOutButton: MockButton
  rotateLeftButton: MockButton
  rotateRightButton: MockButton
  setFullPage: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  preserveOverlays: boolean
  activeOverlays: Set<HTMLElement>
  fire: (event: string, payload?: unknown) => void
}

const osdState = vi.hoisted(() => ({
  viewers: [] as MockViewer[],
  viewerOptions: [] as Record<string, unknown>[],
  buttons: [] as MockButton[],
  trackers: [] as { options: MockTrackerOptions; destroy: ReturnType<typeof vi.fn> }[],
  initError: null as Error | null,
}))

const observabilityMocks = vi.hoisted(() => ({
  emitEvent: vi.fn(),
  emitEventNow: vi.fn(),
  emitFrontendError: vi.fn(),
  emitFrontendPerformance: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  fetchImageMarkers: vi.fn(),
  fetchBoards: vi.fn().mockResolvedValue([]),
  fetchImage: vi.fn(),
  userMessage: vi.fn((_err: unknown, fallback: string) => fallback),
  startCount: vi.fn(),
  getCount: vi.fn(),
  cancelCount: vi.fn(),
  deleteMarker: vi.fn(),
}))

vi.mock('../../src/observability', () => observabilityMocks)

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchImageMarkers: apiMocks.fetchImageMarkers,
    fetchBoards: apiMocks.fetchBoards,
    fetchImage: apiMocks.fetchImage,
    userMessage: apiMocks.userMessage,
    startCount: apiMocks.startCount,
    getCount: apiMocks.getCount,
    cancelCount: apiMocks.cancelCount,
    deleteMarker: apiMocks.deleteMarker,
  }
})

vi.mock('openseadragon', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSDPoint(this: any, x: number, y: number) {
    this.x = x
    this.y = y
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSDRect(this: any, x: number, y: number, width: number, height: number) {
    this.x = x
    this.y = y
    this.width = width
    this.height = height
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSDButton(this: any, options: MockButton['options']) {
    this.options = options
    this.element = document.createElement('div')
    for (let i = 0; i < 4; i += 1) {
      this.element.appendChild(document.createElement('img'))
    }
    osdState.buttons.push(this)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function OSDMouseTracker(this: any, options: MockTrackerOptions) {
    this.options = options
    this.destroy = vi.fn()
    osdState.trackers.push(this)
  }

  const makeViewer = (): MockViewer => {
    const handlers = new Map<string, ((event: unknown) => void)[]>()
    const onceHandlers = new Map<string, ((event: unknown) => void)[]>()
    const container = document.createElement('div')
    // Mirror OSD's ControlDock layout: per-anchor dock divs are children of the
    // container and hold inline-block wrappers around each control element.
    const bottomLeftDock = document.createElement('div')
    const bottomRightDock = document.createElement('div')
    const topRightDock = document.createElement('div')
    const topLeftDock = document.createElement('div')
    container.appendChild(bottomLeftDock)
    container.appendChild(bottomRightDock)
    container.appendChild(topRightDock)
    container.appendChild(topLeftDock)
    const navigatorElement = document.createElement('div')
    bottomRightDock.appendChild(navigatorElement)
    const activeOverlays = new Set<HTMLElement>()
    // Track full-page state the way real OSD does: setFullPage(true) flips it
    // immediately (the 'full-page' event fires during construction in the
    // handoff path, before ImageViewer's handlers exist).
    let fullPageState = false
    const homeBounds = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      getCenter: () => ({ x: 0.5, y: 0.4 }),
    }
    const viewportState: MockViewportState = {
      current: { zoom: 2, center: { x: 0.5, y: 0.4 }, rotation: 90 },
      target: { zoom: 2, center: { x: 0.5, y: 0.4 }, rotation: 90 },
    }
    const viewer: MockViewer = {
      element: document.createElement('div'),
      container,
      canvas: document.createElement('div'),
      navigator: { element: navigatorElement },
      viewportState,
      world: {
        getItemAt: vi.fn(() => ({ getContentSize: () => ({ x: 1000, y: 800 }) })),
      },
      viewport: {
        getZoom: vi.fn((current = false) =>
          current ? viewportState.current.zoom : viewportState.target.zoom,
        ),
        getCenter: vi.fn((current = false) =>
          current ? viewportState.current.center : viewportState.target.center,
        ),
        getRotation: vi.fn((current = false) =>
          current ? viewportState.current.rotation : viewportState.target.rotation,
        ),
        getHomeZoom: vi.fn(() => 2),
        getHomeBounds: vi.fn(() => homeBounds),
        getFlip: vi.fn(() => false),
        setRotation: vi.fn(),
        rotateTo: vi.fn(),
        zoomTo: vi.fn(),
        panTo: vi.fn(),
        fitBounds: vi.fn(),
        // Real OSD: goHome raises 'home' on the viewer before fitting.
        goHome: vi.fn(() => viewer.fire('home', { immediately: false })),
        pixelFromPoint: vi.fn((p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 })),
        pointFromPixel: vi.fn((p: { x: number; y: number }) => ({ x: p.x / 100, y: p.y / 100 })),
        viewportToImageZoom: vi.fn((zoom: number) => zoom * 0.001),
        // Linear 1000x800 image space for counting level-0 conversions.
        viewportToImageRectangle: vi.fn(
          (r: { x: number; y: number; width: number; height: number }) => ({
            x: r.x * 1000,
            y: r.y * 800,
            width: r.width * 1000,
            height: r.height * 800,
          }),
        ),
        viewportToViewerElementCoordinates: vi.fn((p: { x: number; y: number }) => ({
          x: p.x * 100,
          y: p.y * 100,
        })),
        imageToViewerElementCoordinates: vi.fn((p: { x: number; y: number }) => ({
          x: p.x,
          y: p.y,
        })),
      },
      addHandler: vi.fn((event: string, handler: (event: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      }),
      addOnceHandler: vi.fn((event: string, handler: (event: unknown) => void) => {
        onceHandlers.set(event, [...(onceHandlers.get(event) ?? []), handler])
      }),
      addControl: vi.fn((el: HTMLElement, options?: { anchor?: number }) => {
        const wrapper = document.createElement('div')
        wrapper.appendChild(el)
        const dock =
          options?.anchor === OSD.ControlAnchor.TOP_RIGHT
            ? topRightDock
            : options?.anchor === OSD.ControlAnchor.TOP_LEFT
              ? topLeftDock
              : bottomLeftDock
        dock.appendChild(wrapper)
      }),
      removeControl: vi.fn(),
      setControlsEnabled: vi.fn(),
      addOverlay: vi.fn((element: HTMLElement) => activeOverlays.add(element)),
      updateOverlay: vi.fn(),
      removeOverlay: vi.fn((element: HTMLElement) => activeOverlays.delete(element)),
      setMouseNavEnabled: vi.fn(),
      isFullPage: vi.fn(() => fullPageState),
      fullPageButton: new OSDButton({
        tooltip: 'Full screen',
        onClick: () => {},
      }),
      zoomInButton: new OSDButton({
        tooltip: 'Zoom in',
        onClick: () => {},
      }),
      zoomOutButton: new OSDButton({
        tooltip: 'Zoom out',
        onClick: () => {},
      }),
      rotateLeftButton: new OSDButton({
        tooltip: 'Rotate left',
        onClick: () => {},
      }),
      rotateRightButton: new OSDButton({
        tooltip: 'Rotate right',
        onClick: () => {},
      }),
      setFullPage: vi.fn((value: boolean) => {
        fullPageState = value
      }),
      open: vi.fn(() => {
        if (!viewer.preserveOverlays) activeOverlays.clear()
      }),
      removeHandler: vi.fn(),
      destroy: vi.fn(),
      preserveOverlays: false,
      activeOverlays,
      fire: (event: string, payload?: unknown) => {
        for (const handler of handlers.get(event) ?? []) handler(payload)
        const once = onceHandlers.get(event) ?? []
        onceHandlers.set(event, [])
        for (const handler of once) handler(payload)
      },
    }
    // Mirror real OSD nesting: element > container > canvas, so DOM checks
    // like viewer.element.contains(target) behave the same as in the app.
    viewer.element.appendChild(container)
    container.appendChild(viewer.canvas)
    return viewer
  }

  const OSD = (options: Record<string, unknown>) => {
    if (osdState.initError) throw osdState.initError
    const viewer = makeViewer()
    osdState.viewerOptions.push(options)
    osdState.viewers.push(viewer)
    return viewer
  }
  OSD.Point = OSDPoint
  OSD.Rect = OSDRect
  OSD.Button = OSDButton
  OSD.MouseTracker = OSDMouseTracker
  OSD.ControlAnchor = { TOP_RIGHT: 1, TOP_LEFT: 2, BOTTOM_LEFT: 3 }
  return { default: OSD }
})

const canvasOverlayMockState = vi.hoisted(() => ({
  // When true the registered cancel handler behaves like a dirty-draft cancel
  // answered with "Keep editing": edit mode stays on.
  cancelKeepsEditing: false,
}))

vi.mock('../../src/components/CanvasOverlay', () => ({
  default: ({
    editMode,
    onEditModeChange,
    registerCancelHandler,
  }: {
    editMode: boolean
    onEditModeChange: (mode: boolean) => void
    registerCancelHandler: (handler: (() => Promise<void>) | null) => void
  }) => {
    registerCancelHandler(async () => {
      if (!canvasOverlayMockState.cancelKeepsEditing) onEditModeChange(false)
    })
    return (
      <div>
        <div>canvas edit: {String(editMode)}</div>
        <button type="button" onClick={() => onEditModeChange(false)}>
          Overlay done
        </button>
      </div>
    )
  },
}))

import ImageViewer from '../../src/components/ImageViewer'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../../src/components/markerFixtures'
import type { MarkerFormDialogProps } from '../../src/components/MarkerFormDialog'
const CREATED_MARKER = { ...MARKER_FIXTURE, id: 99, title: 'New saved view' }
vi.mock('../../src/components/MarkerFormDialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/MarkerFormDialog')>()),
  default: ({ view, item, onChanged, onClose, inline }: MarkerFormDialogProps) => (
    <div role={inline ? 'form' : 'dialog'} aria-label={inline ? 'Edit Marker' : 'Add Marker'}>
      <span>
        {JSON.stringify({ x: view.x, y: view.y, zoom: view.zoom, rotation: view.rotation })}
      </span>
      {item && <span>Editing Marker {item.id}</span>}
      {['Create', 'Edit', 'Delete'].map((action) => (
        <button
          key={action}
          onClick={async () => {
            await onChanged(action === 'Create' ? CREATED_MARKER : undefined)
            onClose()
          }}
        >
          {action} Marker
        </button>
      ))}
    </div>
  ),
}))
import type { ApiImage } from '../../src/api'
import { resetTileTokenRenewalCacheForTests } from '../../src/tileTokenRenewal'
import { resetViewerPanelPrefsForTests } from '../../src/useViewerPanelState'
import { resetMarkerVisibilityPrefsForTests } from '../../src/useMarkerVisibilityPrefs'

const viewer = () => osdState.viewers[osdState.viewers.length - 1]
const buttonByTooltip = (tooltip: string) => {
  const button = osdState.buttons.find((b) => b.options.tooltip === tooltip)
  if (!button) throw new Error(`No toolbar button with tooltip: ${tooltip}`)
  return button
}
const tracker = () => osdState.trackers[osdState.trackers.length - 1]

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Draw a selection rectangle via the captured MouseTracker handlers. */
function drawRect(opts: { shiftKey?: boolean; drag?: boolean } = {}) {
  const { options } = tracker()
  act(() => {
    buttonByTooltip('Draw selection rectangle').options.onClick()
    options.pressHandler({ position: { x: 10, y: 10 } })
    if (opts.drag !== false) {
      options.dragHandler({
        position: { x: 30, y: 20 },
        originalEvent: { shiftKey: opts.shiftKey ?? false },
      })
    }
    options.releaseHandler()
  })
}

beforeEach(() => {
  localStorage.clear()
  osdState.viewers.length = 0
  osdState.viewerOptions.length = 0
  osdState.buttons.length = 0
  osdState.trackers.length = 0
  osdState.initError = null
  canvasOverlayMockState.cancelKeepsEditing = false
  resetTileTokenRenewalCacheForTests()
  resetViewerPanelPrefsForTests()
  resetMarkerVisibilityPrefsForTests()
  setFullscreenElement(null)
  vi.useRealTimers()
  vi.clearAllMocks()
  apiMocks.fetchImageMarkers.mockReset().mockResolvedValue([])
  apiMocks.fetchBoards.mockReset().mockResolvedValue([BOARD_FIXTURE])
  apiMocks.deleteMarker.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (hadFullscreenElementOwnProperty && originalFullscreenElementDescriptor) {
    Object.defineProperty(document, 'fullscreenElement', originalFullscreenElementDescriptor)
  } else {
    Reflect.deleteProperty(document, 'fullscreenElement')
  }
  if (hadExitFullscreenOwnProperty && originalExitFullscreenDescriptor) {
    Object.defineProperty(document, 'exitFullscreen', originalExitFullscreenDescriptor)
  } else {
    Reflect.deleteProperty(document, 'exitFullscreen')
  }
})

describe('Marker viewer tool', () => {
  it.each([true, false])(
    'keeps own and instructor views prominent while classmate views collapse hidden, panel=%s',
    async (viewerPanel) => {
      const classmateBoard = {
        ...BOARD_FIXTURE,
        id: 4,
        name: 'Classmate picks',
        visibility: 'public' as const,
        owners: [{ user_id: 42, program_id: null, name: 'Sam', role: 'student' as const }],
        permissions: {
          can_edit: false,
          can_change_scope: false,
          can_delete: false,
          can_transfer: false,
        },
      }
      apiMocks.fetchBoards.mockResolvedValue([BOARD_FIXTURE, classmateBoard])
      apiMocks.fetchImageMarkers.mockResolvedValue([
        MARKER_FIXTURE,
        { ...MARKER_FIXTURE, id: 8, title: 'Instructor view', source: 'instructor' },
        {
          ...MARKER_FIXTURE,
          id: 9,
          title: 'Other student view',
          source: 'public',
          board_ids: [4],
          permissions: { can_edit: false, can_delete: false },
        },
      ])
      const rendered = render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={42}
            markersEnabled
            viewerPanel={viewerPanel}
          />
        </AuthContext.Provider>,
      )
      rendered.container.appendChild(viewer().element)
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="8"]')).not.toBeNull(),
      )
      // Classmate markers default to canvas-hidden until the drawer opts in.
      expect(viewer().container.querySelector('[data-marker-id="9"] button')).toBeNull()
      fireEvent.click(
        await within(viewer().container).findByRole('button', {
          name: viewerPanel ? 'Open viewer panel' : 'Markers (3)',
        }),
      )
      const list = within(await screen.findByRole('complementary'))
      expect(list.getByRole('button', { name: 'View Marker: Rose window' })).toBeVisible()
      expect(list.getByRole('button', { name: 'View Marker: Instructor view' })).toBeVisible()
      expect(list.queryByText('Other student view')).not.toBeInTheDocument()
      fireEvent.click(list.getByRole('button', { name: 'Public & Shared' }))
      expect(
        list.getByRole('button', { name: 'View Marker: Other student view (marker hidden)' }),
      ).toBeInTheDocument()
      fireEvent.click(list.getByRole('button', { name: 'Public & Shared markers' }))
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="9"] button')).not.toBeNull(),
      )
    },
  )
  it.each([true, false])(
    'routes Board group headings through onOpenBoard, permanent panel=%s',
    async (viewerPanel) => {
      apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
      const onOpenBoard = vi.fn()
      const rendered = render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={42}
            markersEnabled
            viewerPanel={viewerPanel}
            onOpenBoard={onOpenBoard}
          />
        </AuthContext.Provider>,
      )
      rendered.container.appendChild(viewer().element)
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="7"]')).not.toBeNull(),
      )
      fireEvent.click(
        await within(viewer().container).findByRole('button', {
          name: viewerPanel ? 'Open viewer panel' : 'Markers (1)',
        }),
      )
      const list = within(await screen.findByRole('complementary'))
      fireEvent.click(
        await list.findByRole('button', { name: 'Open Board: Architecture inspiration' }),
      )
      expect(onOpenBoard).toHaveBeenCalledWith(1, viewer().container)
    },
  )
  it.each([true, false])(
    'reveals, navigates to and focuses a hidden marker passed through markerFocus, panel=%s',
    async (viewerPanel) => {
      const classmateBoard = {
        ...BOARD_FIXTURE,
        id: 4,
        name: 'Classmate picks',
        visibility: 'public' as const,
        owners: [{ user_id: 42, program_id: null, name: 'Sam', role: 'student' as const }],
        permissions: {
          can_edit: false,
          can_change_scope: false,
          can_delete: false,
          can_transfer: false,
        },
      }
      apiMocks.fetchBoards.mockResolvedValue([BOARD_FIXTURE, classmateBoard])
      apiMocks.fetchImageMarkers.mockResolvedValue([
        MARKER_FIXTURE,
        {
          ...MARKER_FIXTURE,
          id: 9,
          title: 'Other student view',
          source: 'public',
          board_ids: [4],
          permissions: { can_edit: false, can_delete: false },
        },
      ])
      const rendered = render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={42}
            markersEnabled
            viewerPanel={viewerPanel}
            markerFocus={{ id: 9, imageId: 42 }}
          />
        </AuthContext.Provider>,
      )
      rendered.container.appendChild(viewer().element)
      // The canvas-hidden marker is revealed once markers and the viewer are ready.
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="9"] button')).not.toBeNull(),
      )
      expect(viewer().viewport.panTo).toHaveBeenCalled()
      // The focused Marker's info card opens so its description is visible.
      expect(
        await within(viewer().container).findByRole('heading', { name: 'Other student view' }),
      ).toBeInTheDocument()
      // Only the target marker gets a visibility override — nothing else leaks.
      const stored = JSON.parse(localStorage.getItem('hriv.markerVisibility.9') ?? '{}') as {
        items?: { id: number; markerVisible?: boolean }[]
      }
      expect(stored.items).toContainEqual(expect.objectContaining({ id: 9, markerVisible: true }))
      expect(stored.items?.find((row) => row.id === 7)).toBeUndefined()
      // The drawer reports the focused marker and auto-expands the shared tier.
      fireEvent.click(
        await within(viewer().container).findByRole('button', {
          name: viewerPanel ? 'Open viewer panel' : 'Markers (2)',
        }),
      )
      const list = within(await screen.findByRole('complementary'))
      expect(list.getByRole('button', { name: 'Public & Shared' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(list.getByRole('button', { name: 'View Marker: Other student view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    },
  )
  it('selects and reveals a focused marker without re-centring when navigate=false', async () => {
    apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
    const rendered = render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer
          tileSources="/test.dzi"
          imageId={42}
          markersEnabled
          markerFocus={{ id: 7, imageId: 42, navigate: false }}
        />
      </AuthContext.Provider>,
    )
    rendered.container.appendChild(viewer().element)
    // The marker is still selected and the drawer reports focus…
    await waitFor(() =>
      expect(viewer().container.querySelector('[data-marker-id="7"] button')).not.toBeNull(),
    )
    fireEvent.click(
      await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
    )
    const list = within(await screen.findByRole('complementary'))
    expect(list.getByRole('button', { name: 'View Marker: Rose window' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // …but the shared viewport is left untouched.
    expect(viewer().viewport.panTo).not.toHaveBeenCalled()
    expect(viewer().viewport.zoomTo).not.toHaveBeenCalled()
  })
  it('applies the recorded viewport when navigate=false carries one', async () => {
    apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
    const rendered = render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer
          tileSources="/test.dzi"
          imageId={42}
          markersEnabled
          markerFocus={{
            id: 7,
            imageId: 42,
            navigate: false,
            viewport: { x: 0.3, y: 0.4, zoom: 5, rotation: 90 },
          }}
        />
      </AuthContext.Provider>,
    )
    rendered.container.appendChild(viewer().element)
    // A same-image history pop cannot rely on initialViewport (keyed by
    // image id) — the focus payload restores the recorded view instead.
    await waitFor(() => expect(viewer().viewport.panTo).toHaveBeenCalled())
    expect(viewer().viewport.panTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.3, y: 0.4 }),
      false,
    )
    expect(viewer().viewport.zoomTo).toHaveBeenCalledWith(5, undefined, false)
    expect(viewer().viewport.setRotation).toHaveBeenCalledWith(90, false)
  })
  it('reloads markers when markersReloadSignal changes', async () => {
    apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
    const rendered = render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled markersReloadSignal={1} />
      </AuthContext.Provider>,
    )
    rendered.container.appendChild(viewer().element)
    await waitFor(() => expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(1))
    rendered.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled markersReloadSignal={2} />
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(2))
    // A rerender with the same signal does not reload again.
    rendered.rerender(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled markersReloadSignal={2} />
      </AuthContext.Provider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(2)
  })
  it.each([true, false])(
    'reveals a canvas-hidden marker when its drawer row is selected, panel=%s',
    async (viewerPanel) => {
      const classmateBoard = {
        ...BOARD_FIXTURE,
        id: 4,
        name: 'Classmate picks',
        visibility: 'public' as const,
        owners: [{ user_id: 42, program_id: null, name: 'Sam', role: 'student' as const }],
        permissions: {
          can_edit: false,
          can_change_scope: false,
          can_delete: false,
          can_transfer: false,
        },
      }
      apiMocks.fetchBoards.mockResolvedValue([BOARD_FIXTURE, classmateBoard])
      apiMocks.fetchImageMarkers.mockResolvedValue([
        MARKER_FIXTURE,
        {
          ...MARKER_FIXTURE,
          id: 9,
          title: 'Other student view',
          source: 'public',
          board_ids: [4],
          permissions: { can_edit: false, can_delete: false },
        },
      ])
      const rendered = render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={42}
            markersEnabled
            viewerPanel={viewerPanel}
          />
        </AuthContext.Provider>,
      )
      rendered.container.appendChild(viewer().element)
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="7"] button')).not.toBeNull(),
      )
      expect(viewer().container.querySelector('[data-marker-id="9"] button')).toBeNull()
      fireEvent.click(
        await within(viewer().container).findByRole('button', {
          name: viewerPanel ? 'Open viewer panel' : 'Markers (2)',
        }),
      )
      const list = within(await screen.findByRole('complementary'))
      fireEvent.click(list.getByRole('button', { name: 'Public & Shared' }))
      fireEvent.click(
        list.getByRole('button', { name: 'View Marker: Other student view (marker hidden)' }),
      )
      await waitFor(() =>
        expect(viewer().container.querySelector('[data-marker-id="9"] button')).not.toBeNull(),
      )
      expect(viewer().viewport.panTo).toHaveBeenCalled()
    },
  )
  it('copies the live image view and rectangles from the Share View tab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(
      <ImageViewer
        tileSources="/test.dzi"
        imageId={42}
        markersEnabled
        initialOverlays={[{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]}
      />,
    )
    fireEvent.click(
      await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
    )
    viewer().viewport.getCenter.mockReturnValue({ x: 0.46, y: 0.29 })
    viewer().viewport.getZoom.mockReturnValue(2.5)
    viewer().viewport.getRotation.mockReturnValue(35)
    fireEvent.click(screen.getByRole('button', { name: 'Show Share View' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share View' }))
    await screen.findByText('Link copied to clipboard')
    const url = new URL(writeText.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      image: '42',
      zoom: '2.5000',
      x: '0.460000',
      y: '0.290000',
      rotation: '35.0',
      ov0: '0.10000000,0.20000000,0.30000000,0.40000000',
    })
  })
  it('reuses the page share handler when supplied', async () => {
    const copy = vi.fn()
    render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled onShareView={copy} />)
    fireEvent.click(
      await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Share View' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share View' }))
    expect(copy).toHaveBeenCalledTimes(1)
  })
  it('persists the permanent right panel across images and remounts, without dismissing on canvas presses or Escape', async () => {
    const view = (imageId: number) => (
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer
          imageId={imageId}
          tileSources="/test.dzi"
          markersEnabled
          canEditContent
          sidePanelDetails={<p>Metadata</p>}
        />
      </AuthContext.Provider>
    )
    const first = render(view(42))
    fireEvent.click(
      await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show image details' }))
    expect(viewer().container.style.width).toBe('calc(100% - 256px)')
    const instance = viewer()
    fireEvent.pointerDown(instance.canvas)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('complementary', { name: 'Viewer panel' })).toBeVisible()
    expect(viewer()).toBe(instance)
    act(() => buttonByTooltip('Canvas annotations (add shapes, text, links)').options.onClick())
    expect(screen.getByText('canvas edit: true')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Viewer panel' })).toBeVisible()
    expect(viewer().container.style.width).toBe('calc(100% - 256px)')
    fireEvent.click(screen.getByRole('button', { name: 'Overlay done' }))
    first.rerender(view(43))
    expect(screen.getByText('Metadata')).toBeVisible()
    first.unmount()
    render(view(44))
    expect(await screen.findByRole('button', { name: 'Close viewer panel' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show image details' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const add = osdState.buttons.filter((button) => button.options.tooltip === 'Add Marker').at(-1)!
    act(() => add.options.onClick())
    act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
    expect(screen.getByRole('button', { name: 'Show Markers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('complementary', { name: 'Viewer panel' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer panel' }))
    expect(viewer().container.style.width).toBe('100%')
    expect(viewer().container.style.getPropertyValue('--hriv-marker-panel-right')).toBe('56px')
  })

  it.each([false, true])(
    'keeps only pinned drawers open across image changes and new viewer pages, pinned=%s',
    async (pinned) => {
      const view = (imageId: number) => (
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={imageId}
            markersEnabled
            viewerPanel={false}
          />
        </AuthContext.Provider>
      )
      const first = render(view(42))
      fireEvent.click(
        await within(viewer().container).findByRole('button', { name: 'Markers (0)' }),
      )
      if (pinned)
        fireEvent.click(within(viewer().container).getByRole('button', { name: 'Pin Markers' }))
      first.rerender(view(43))
      const trigger = await within(viewer().container).findByRole('button', {
        name: 'Markers (0)',
      })
      expect(trigger).toHaveAttribute('aria-expanded', String(pinned))
      if (pinned) {
        expect(
          within(viewer().container).getByRole('button', { name: 'Unpin Markers' }),
        ).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(viewer().container).getByRole('button', { name: 'Unpin Markers' }))
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        fireEvent.click(within(viewer().container).getByRole('button', { name: 'Pin Markers' }))
      }
      first.unmount()
      render(view(44))
      expect(
        await within(viewer().container).findByRole('button', { name: 'Markers (0)' }),
      ).toHaveAttribute('aria-expanded', String(pinned))
      expect(localStorage.getItem('hrivpref:markers-drawer:pinned:user:9')).toBe(
        pinned ? 'true' : null,
      )
    },
  )
  it('closes the unpinned drawer on a canvas press without suppressing quick-click placement', async () => {
    const rendered = render(
      <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled viewerPanel={false} />,
    )
    rendered.container.appendChild(viewer().element)
    act(() => buttonByTooltip('Add Marker').options.onClick())
    const trigger = await within(viewer().container).findByRole('button', { name: 'Markers (0)' })
    fireEvent.click(trigger)
    fireEvent.pointerDown(viewer().canvas)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      JSON.stringify({ x: 0.3, y: 0.4, zoom: 2, rotation: 90 }),
    )
    expect(buttonByTooltip('Add Marker').element).toHaveAttribute('aria-pressed', 'true')
  })
  it.each([false, true])(
    'does not consume Escape without an image or draft, flag=%s',
    (markersEnabled) => {
      render(<ImageViewer tileSources="/test.dzi" markersEnabled={markersEnabled} />)
      const onEscape = vi.fn()
      const target = document.createElement('button')
      document.body.appendChild(target)
      target.addEventListener('keydown', onEscape)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      expect(onEscape).toHaveBeenCalledOnce()
      expect(event.defaultPrevented).toBe(false)
      target.remove()
    },
  )
  it.each([false, true])(
    'selects and focuses the created row, opening the Markers tab when needed, panelOpen=%s',
    async (keepOpen) => {
      apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
      render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />
        </AuthContext.Provider>,
      )
      fireEvent.click(
        await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
      )
      const previous = await screen.findByRole('button', { name: 'View Marker: Rose window' })
      fireEvent.click(previous)
      fireEvent.click(
        screen.getByRole('button', {
          name: keepOpen ? 'Show image details' : 'Close viewer panel',
        }),
      )
      act(() => buttonByTooltip('Add Marker').options.onClick())
      act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
      apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE, CREATED_MARKER])
      const pans = viewer().viewport.panTo.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Create Marker' }))
      const created = await screen.findByRole('button', { name: 'View Marker: New saved view' })
      // Creating a Marker re-orients the viewport onto it.
      expect(viewer().viewport.panTo.mock.calls.length).toBe(pans + 1)
      expect(viewer().viewport.panTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ x: 0.46, y: 0.29 }),
        false,
      )
      expect(viewer().viewport.zoomTo).toHaveBeenLastCalledWith(2.5, undefined, false)
      expect(viewer().viewport.setRotation).toHaveBeenLastCalledWith(0, false)
      await waitFor(() => expect(created).toHaveFocus())
      expect(created).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'View Marker: Rose window' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(
        within(viewer().container).getByRole('region', { name: 'Marker information' }),
      ).toHaveTextContent('New saved view')
      expect(buttonByTooltip('Add Marker').element).toHaveAttribute('aria-pressed', 'true')
    },
  )
  it.each([true, false])(
    'confirms drawer Delete without the information card, panelOpen=%s',
    async (viewerPanel) => {
      apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
      render(
        <AuthContext.Provider value={BOARD_AUTH}>
          <ImageViewer
            tileSources="/test.dzi"
            imageId={42}
            markersEnabled
            viewerPanel={viewerPanel}
          />
        </AuthContext.Provider>,
      )
      fireEvent.click(
        await within(viewer().container).findByRole('button', {
          name: viewerPanel ? 'Open viewer panel' : 'Markers (1)',
        }),
      )
      // The panel drawer mounts in the page, but the legacy drawer, its menu
      // and the confirmation all portal into the (detached) viewer container.
      const drawerScope = viewerPanel ? screen : within(viewer().container)
      const canvas = within(viewer().container)
      fireEvent.click(await drawerScope.findByRole('button', { name: 'Rose window options' }))
      fireEvent.click(drawerScope.getByRole('menuitem', { name: 'Delete' }))
      // Named queries can't resolve aria-labelledby inside the detached
      // viewer container, so assert the title text instead.
      const confirmation = canvas.getByRole('dialog')
      expect(within(confirmation).getByText('Delete Marker?')).toBeTruthy()
      expect(within(confirmation).getByText(/permanently deleted from all its Boards/)).toBeTruthy()
      expect(canvas.queryByRole('region', { name: 'Marker information' })).toBeNull()
      expect(canvas.queryByRole('form', { name: 'Edit Marker' })).toBeNull()
      expect(canvas.queryByText('Editing Marker 7')).toBeNull()
      expect(viewer().viewport.panTo).not.toHaveBeenCalled()
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull())
      expect(apiMocks.deleteMarker).not.toHaveBeenCalled()
      fireEvent.click(drawerScope.getByRole('button', { name: 'Rose window options' }))
      fireEvent.click(drawerScope.getByRole('menuitem', { name: 'Delete' }))
      fireEvent.click(
        within(canvas.getByRole('dialog')).getByRole('button', {
          name: 'Delete',
        }),
      )
      await waitFor(() => expect(apiMocks.deleteMarker).toHaveBeenCalledWith(7, 3))
      await waitFor(() => expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull())
    },
  )
  it('keeps the mode armed after save, lists the draft and cancels it before Escape disarms the tool', async () => {
    render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />)
    act(() => buttonByTooltip('Add Marker').options.onClick())
    const event = { quick: true, position: { x: 30, y: 40 }, preventDefaultAction: false }
    act(() => viewer().fire('canvas-click', event))
    expect(event.preventDefaultAction).toBe(true)
    fireEvent.click(
      await within(viewer().container).findByRole('button', { name: 'Open viewer panel' }),
    )
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
    expect(buttonByTooltip('Add Marker').element).toHaveAttribute('aria-pressed', 'true')
    act(() => viewer().fire('canvas-click', event))
    fireEvent.click(screen.getByRole('button', { name: 'Create Marker' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(buttonByTooltip('Add Marker').element).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(buttonByTooltip('Add Marker').element).toHaveAttribute('aria-pressed', 'false')
  })
  it('bounds viewer commits for group, per-row and Mixed visibility actions without remounting or refetching', async () => {
    localStorage.removeItem('hriv.markerVisibility.9')
    apiMocks.fetchImageMarkers.mockResolvedValue([
      MARKER_FIXTURE,
      { ...MARKER_FIXTURE, id: 8, title: 'Second view' },
    ])
    const commits = vi.fn()
    render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <Profiler id="viewer" onRender={commits}>
          <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />
        </Profiler>
      </AuthContext.Provider>,
    )
    const instance = viewer()
    const canvas = screen
    fireEvent.click(
      await within(instance.container).findByRole('button', { name: 'Open viewer panel' }),
    )
    const drawer = within(await canvas.findByRole('complementary'))
    const click = (button: HTMLElement) => {
      commits.mockClear()
      fireEvent.click(button)
      expect(commits.mock.calls.length).toBeLessThan(8)
    }
    const markerMenu = (name: string) => {
      click(drawer.getByRole('button', { name: `${name} options` }))
      return canvas.getByRole('menuitemcheckbox', { name: `${name} marker` })
    }
    const groupMarkers = drawer.getByRole('button', {
      name: 'Architecture inspiration markers',
    })
    const groupLabels = drawer.getByRole('button', { name: 'Architecture inspiration labels' })
    click(groupMarkers)
    expect(instance.container.querySelector('[data-marker-id="7"] button')).toBeNull()
    // A hidden marker always hides its label, so the anchor renders nothing.
    expect(instance.container.querySelector('[data-marker-id="7"] span')).toBeNull()
    expect(groupLabels).toBeDisabled()
    click(markerMenu('Rose window'))
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'mixed')
    click(groupMarkers)
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'true')
    const labels = (name: string) => {
      click(drawer.getByRole('button', { name: `${name} options` }))
      click(canvas.getByRole('menuitemcheckbox', { name: `${name} labels` }))
    }
    click(groupLabels)
    expect(instance.container.querySelector('[data-marker-id="7"] span')).toBeNull()
    expect(instance.container.querySelector('[data-marker-id="7"] button')).not.toBeNull()
    labels('Rose window')
    expect(groupLabels).toHaveAttribute('aria-pressed', 'mixed')
    click(groupLabels)
    expect(instance.container.querySelector('[data-marker-id="8"] span')).not.toBeNull()
    expect(osdState.viewers).toHaveLength(1)
    expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(1)
  })
  it('shares one image request with the right viewer panel, navigates, highlights and independently hides markers', async () => {
    apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
    const onOpenChange = vi.fn()
    render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer
          tileSources="/test.dzi"
          imageId={42}
          markersEnabled
          onViewerPanelWidthChange={onOpenChange}
        />
      </AuthContext.Provider>,
    )
    const canvas = screen
    const trigger = await within(viewer().container).findByRole('button', {
      name: 'Open viewer panel',
    })
    expect(viewer().addControl).toHaveBeenCalledWith(expect.any(HTMLDivElement), { anchor: 1 })
    fireEvent.focusIn(trigger)
    expect(viewer().setControlsEnabled).toHaveBeenLastCalledWith(true)
    fireEvent.click(trigger)
    const drawer = await canvas.findByRole('complementary')
    expect(onOpenChange).toHaveBeenLastCalledWith(256)
    expect(trigger).toHaveAttribute('aria-controls', drawer.id)
    fireEvent.click(within(drawer).getByRole('button', { name: 'View Marker: Rose window' }))
    expect(viewer().viewport.panTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.46, y: 0.29 }),
      false,
    )
    expect(viewer().viewport.zoomTo).toHaveBeenCalledWith(2.5, undefined, false)
    expect(
      canvas
        .getAllByRole('button', { name: 'View Marker: Rose window' })
        .some((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Rose window options' }))
    fireEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    // Hiding the marker suppresses its label too — no separate label action needed.
    expect(viewer().container.querySelector('[data-marker-id="7"]')).toBeEmptyDOMElement()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Rose window options' }))
    expect(canvas.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(canvas.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.keyDown(canvas.getByRole('menu'), { key: 'Escape' })
    expect(
      within(drawer).getByRole('button', { name: 'View Marker: Rose window (marker hidden)' }),
    ).toBeDefined()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Rose window options' }))
    expect(canvas.getByRole('menuitemcheckbox', { name: 'Rose window marker' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    fireEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Rose window options' }))
    fireEvent.click(canvas.getByRole('menuitem', { name: 'Edit' }))
    expect(within(viewer().container).getByRole('form', { name: 'Edit Marker' })).toBeDefined()
    expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(1)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close viewer panel' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(0)
  })
  it('is completely gated off, including network loading', () => {
    render(<ImageViewer tileSources="/test.dzi" imageId={42} />)
    expect(osdState.buttons.some((button) => button.options.tooltip === 'Add Marker')).toBe(false)
    expect(apiMocks.fetchImageMarkers).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'captures the same image point with flip=%s and previews it',
    async (flip) => {
      const rendered = render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />)
      rendered.container.appendChild(viewer().element)
      Object.defineProperty(viewer().canvas, 'clientWidth', { value: 200 })
      viewer().viewport.getFlip.mockReturnValue(flip)
      viewer().viewport.getZoom.mockReturnValue(4)
      viewer().viewport.getRotation.mockReturnValue(35)
      act(() => buttonByTooltip('Add Marker').options.onClick())
      expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
      act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
      expect(await screen.findByRole('dialog')).toHaveTextContent(
        JSON.stringify({ x: 0.3, y: 0.4, zoom: 4, rotation: 35 }),
      )
      expect(viewer().container).toContainElement(
        within(viewer().container).getByRole('button', { name: 'View Marker: New Marker' }),
      )
      expect(viewer().container.querySelector('[data-marker-id="-1"]')).toHaveStyle({
        left: `${flip ? 170 : 30}px`,
        top: '40px',
      })
      expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
    },
  )
  it('Escape cancels placement and a drag is never treated as a click', () => {
    render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />)
    act(() => buttonByTooltip('Add Marker').options.onClick())
    act(() => viewer().fire('canvas-click', { quick: false, position: { x: 30, y: 40 } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
  })
  it('mutually excludes selection, annotation edit and placement, respecting the dirty-draft cancel flow', async () => {
    render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled canEditContent />)
    act(() => buttonByTooltip('Draw selection rectangle').options.onClick())
    act(() => buttonByTooltip('Add Marker').options.onClick())
    act(() => tracker().options.pressHandler({ position: { x: 10, y: 10 } }))
    expect(viewer().addOverlay).not.toHaveBeenCalled()
    act(() => buttonByTooltip('Canvas annotations (add shapes, text, links)').options.onClick())
    expect(screen.getByText('canvas edit: true')).toBeInTheDocument()
    canvasOverlayMockState.cancelKeepsEditing = true
    await act(async () => buttonByTooltip('Add Marker').options.onClick())
    act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    canvasOverlayMockState.cancelKeepsEditing = false
    await act(async () => buttonByTooltip('Add Marker').options.onClick())
    expect(screen.getByText('canvas edit: false')).toBeInTheDocument()
    act(() => viewer().fire('canvas-click', { quick: true, position: { x: 30, y: 40 } }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it.each(['Create', 'Edit', 'Delete'])(
    'refetches the image endpoint after %s and opens existing marker details',
    async (action) => {
      apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
      render(<ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />)
      const marker = await within(viewer().container).findByRole('button', {
        name: 'View Marker: Rose window',
      })
      const canvas = within(viewer().container)
      fireEvent.click(marker)
      expect(viewer().container).toContainElement(
        within(viewer().container).getByRole('region', { name: 'Marker information' }),
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(within(viewer().container).getByRole('button', { name: 'Edit Rose window' }))
      expect(canvas.getByText('Editing Marker 7')).toBeDefined()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(canvas.getByRole('region', { name: 'Marker information' })).toContainElement(
        canvas.getByRole('form', { name: 'Edit Marker' }),
      )
      fireEvent.click(canvas.getByRole('button', { name: action + ' Marker' }))
      await waitFor(() => expect(apiMocks.fetchImageMarkers).toHaveBeenCalledTimes(2))
      expect(apiMocks.fetchImageMarkers).toHaveBeenLastCalledWith(42)
    },
  )
  it('dismisses marker information and selection on outside presses, and opens drawer edits in place', async () => {
    apiMocks.fetchImageMarkers.mockResolvedValue([MARKER_FIXTURE])
    render(
      <AuthContext.Provider value={BOARD_AUTH}>
        <ImageViewer tileSources="/test.dzi" imageId={42} markersEnabled />
      </AuthContext.Provider>,
    )
    const marker = await within(viewer().container).findByRole('button', {
      name: 'View Marker: Rose window',
    })
    const canvas = within(viewer().container)
    fireEvent.click(marker)
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(document.body)
    expect(canvas.queryByRole('region', { name: 'Marker information' })).toBeNull()
    expect(marker).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(viewer().container).getByRole('button', { name: 'Open viewer panel' }))
    const drawer = screen.getByRole('complementary')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Rose window options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const card = canvas.getByRole('region', { name: 'Marker information' })
    expect(card).toContainElement(canvas.getByRole('form', { name: 'Edit Marker' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    expect(viewer().viewport.panTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.46, y: 0.29 }),
      false,
    )
    fireEvent.pointerDown(document.body)
    expect(canvas.getByRole('region', { name: 'Marker information' })).toBe(card)
    fireEvent.click(marker)
    expect(card).toContainElement(canvas.getByRole('form', { name: 'Edit Marker' }))
  })
})

const setViewportAtHome = (v: MockViewer) => {
  const homeBounds = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    getCenter: () => ({ x: 0.5, y: 0.4 }),
  }
  v.viewport.getHomeZoom.mockReturnValue(2)
  v.viewport.getHomeBounds.mockReturnValue(homeBounds)
  v.viewportState.current.zoom = 2
  v.viewportState.current.center = { x: 0.5, y: 0.4 }
  v.viewportState.current.rotation = 0
  v.viewportState.target.zoom = 2
  v.viewportState.target.center = { x: 0.5, y: 0.4 }
  v.viewportState.target.rotation = 0
  v.viewport.getFlip.mockReturnValue(false)
  return homeBounds
}

describe('ImageViewer drawer configuration', () => {
  it('uses anonymous CORS for the WebGL viewer and canvas for its navigator', () => {
    render(<ImageViewer tileSources="https://tiles.example.test/image.dzi" />)

    expect(osdState.viewerOptions).toHaveLength(1)
    expect(osdState.viewerOptions[0]).toMatchObject({
      crossOriginPolicy: 'Anonymous',
      navigatorDrawer: 'canvas',
    })
  })

  it('portals viewportOverlay content into the OSD container', async () => {
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        viewportOverlay={<div data-testid="viewport-overlay">overlay</div>}
      />,
    )

    // viewer.container is detached in the OSD mock, so query inside it
    // rather than via screen.
    await waitFor(() =>
      expect(viewer().container.querySelector('[data-testid="viewport-overlay"]')).not.toBeNull(),
    )
  })

  it('anchors viewportControl as a top-right OSD control and portals its content', async () => {
    const rendered = render(
      <ImageViewer
        tileSources="/tiles.dzi"
        viewportControl={<button data-testid="viewport-control">info</button>}
      />,
    )
    rendered.container.appendChild(viewer().element)

    await waitFor(() =>
      expect(viewer().addControl).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        expect.objectContaining({ anchor: 1 /* TOP_RIGHT */ }),
      ),
    )
    const wrapper = viewer().addControl.mock.calls.find(
      ([, options]: [HTMLElement, { anchor?: number }]) => options?.anchor === 1,
    )?.[0] as HTMLElement
    // addControl wraps the element; the dock around that wrapper is a
    // direct child of viewer.container and gets the top zIndex.
    const dock = wrapper.parentElement?.parentElement
    expect(dock?.parentElement).toBe(viewer().container)
    expect(dock).toHaveStyle({ zIndex: '26' })
    await waitFor(() =>
      expect(wrapper.querySelector('[data-testid="viewport-control"]')).not.toBeNull(),
    )

    // Keyboard focus inside the control keeps the OSD chrome visible.
    fireEvent.focusIn(wrapper)
    expect(viewer().setControlsEnabled).toHaveBeenLastCalledWith(true)
    fireEvent.focusOut(wrapper)
    expect(viewer().setControlsEnabled).toHaveBeenLastCalledWith(false)
  })

  it('does not start auto-hide on focusout while the control or viewer is still in use', async () => {
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        viewportControl={<button data-testid="viewport-control">info</button>}
      />,
    )
    await waitFor(() => expect(viewer().addControl).toHaveBeenCalled())
    const wrapper = viewer().addControl.mock.calls.find(
      ([, options]: [HTMLElement, { anchor?: number }]) => options?.anchor === 1,
    )?.[0] as HTMLElement

    // Focus moving within the wrapper keeps controls enabled.
    const inner = wrapper.querySelector('[data-testid="viewport-control"]') as HTMLElement
    fireEvent.focusOut(wrapper, { relatedTarget: inner })
    expect(viewer().setControlsEnabled).not.toHaveBeenCalledWith(false)

    // Focus leaving entirely while the viewer is still hovered also keeps them.
    const matchesSpy = vi
      .spyOn(viewer().container, 'matches')
      .mockImplementation((selector: string) => selector === ':hover')
    fireEvent.focusOut(wrapper, { relatedTarget: document.body })
    expect(viewer().setControlsEnabled).not.toHaveBeenCalledWith(false)
    matchesSpy.mockRestore()

    // …and focus leaving while not hovered releases them.
    fireEvent.focusOut(wrapper, { relatedTarget: document.body })
    expect(viewer().setControlsEnabled).toHaveBeenLastCalledWith(false)
  })
})

describe('ImageViewer lifecycle telemetry', () => {
  it('emits view started/ready events and restores the initial viewport and overlays', () => {
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        imageId={7}
        categoryId={3}
        initialViewport={{ zoom: 4, x: 0.25, y: 0.75, rotation: 45 }}
        initialOverlays={[{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]}
      />,
    )

    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'image.view.started', image_id: 7, category_id: 3 }),
    )

    act(() => viewer().fire('open'))

    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'image.view.ready', outcome: 'success' }),
    )
    expect(observabilityMocks.emitFrontendPerformance).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'image_ready', unit: 'ms', imageId: 7 }),
    )
    expect(viewer().viewport.zoomTo).toHaveBeenCalledWith(4, undefined, true)
    expect(viewer().viewport.panTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.25, y: 0.75 }),
      true,
    )
    expect(viewer().viewport.setRotation).toHaveBeenCalledWith(45, true)
    expect(viewer().addOverlay).toHaveBeenCalledTimes(1)

    act(() => {
      viewer().fire('resize')
      viewer().fire('viewport-change')
    })
    expect(viewer().viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('emits failure telemetry when the image fails to open', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)

    act(() => viewer().fire('open-failed'))

    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'image.view.failed', outcome: 'failure' }),
    )
    expect(observabilityMocks.emitFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'image_viewer_open_failed', imageId: undefined }),
    )
  })

  it('emits init failure telemetry and rethrows when OpenSeadragon construction fails', () => {
    osdState.initError = new Error('no canvas')
    expect(() => render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)).toThrow('no canvas')
    expect(observabilityMocks.emitFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'image_viewer_init_failed', imageId: 7 }),
    )
  })

  it('reports the OSD instance through onViewerReady and null on unmount', () => {
    const onViewerReady = vi.fn()
    const { unmount } = render(
      <ImageViewer tileSources="/tiles.dzi" imageId={7} onViewerReady={onViewerReady} />,
    )
    expect(onViewerReady).toHaveBeenCalledWith(viewer())
    unmount()
    expect(onViewerReady).toHaveBeenLastCalledWith(null)
  })

  it('emits a dwell event and destroys the viewer and tracker on unmount', () => {
    const { unmount } = render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)
    const v = viewer()
    const t = tracker()

    unmount()

    expect(observabilityMocks.emitEventNow).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'image.view.ended', image_id: 7 }),
    )
    expect(v.destroy).toHaveBeenCalled()
    expect(t.destroy).toHaveBeenCalled()
  })

  it('leaves full-page mode before destroying the viewer', () => {
    const { unmount } = render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    v.isFullPage.mockReturnValue(true)

    unmount()

    expect(v.setFullPage).toHaveBeenCalledWith(false)
    expect(v.setFullPage.mock.invocationCallOrder[0]).toBeLessThan(
      v.destroy.mock.invocationCallOrder[0],
    )
  })

  it('hands full screen to the keyed replacement viewer without a second toolbar event', () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    const { rerender } = render(
      <ImageViewer key="first" fullScreenHandoffKey="sequence:1" tileSources="/first.dzi" />,
    )
    const first = viewer()
    first.isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)
    act(() => first.fire('full-page', { fullPage: true }))
    const fullScreenActions = () =>
      observabilityMocks.emitEvent.mock.calls.filter(
        ([event]) => (event as { action?: string }).action === 'full_screen',
      ).length
    expect(fullScreenActions()).toBe(1)

    rerender(
      <ImageViewer key="second" fullScreenHandoffKey="sequence:1" tileSources="/second.dzi" />,
    )
    const second = viewer()
    expect(second.setFullPage).toHaveBeenCalledWith(true)
    expect(second.element.style.width).toBe('100%')
    expect(second.element.style.height).toBe('100%')
    expect(fullScreenActions()).toBe(1)
    act(() => vi.advanceTimersByTime(0))
    expect(exitFullscreen).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('uses the latest sequence key when handing off after a collection change', () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    const { rerender } = render(
      <ImageViewer
        key="current"
        fullScreenHandoffKey="sequence:1"
        imageId={1}
        tileSources="/first.dzi"
      />,
    )
    const first = viewer()

    rerender(
      <ImageViewer
        key="current"
        fullScreenHandoffKey="sequence:2"
        imageId={1}
        tileSources="/first.dzi"
      />,
    )
    first.isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)

    rerender(
      <ImageViewer
        key="next"
        fullScreenHandoffKey="sequence:2"
        imageId={2}
        tileSources="/second.dzi"
      />,
    )
    expect(viewer().setFullPage).toHaveBeenCalledWith(true)

    act(() => vi.advanceTimersByTime(0))
    expect(exitFullscreen).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not hand full screen to a different sequence collection', () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    const { rerender } = render(
      <ImageViewer key="first" fullScreenHandoffKey="sequence:1" tileSources="/first.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)

    rerender(
      <ImageViewer key="second" fullScreenHandoffKey="sequence:2" tileSources="/second.dzi" />,
    )
    expect(viewer().setFullPage).not.toHaveBeenCalledWith(true)

    act(() => vi.advanceTimersByTime(0))
    expect(exitFullscreen).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('exits full screen after unmount when no viewer claims the handoff', () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    const { unmount } = render(
      <ImageViewer fullScreenHandoffKey="sequence:1" tileSources="/tiles.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)

    unmount()
    expect(exitFullscreen).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(0))
    expect(exitFullscreen).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('exits full screen immediately when a keyless viewer unmounts', () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    const { unmount } = render(<ImageViewer tileSources="/tiles.dzi" />)
    const currentViewer = viewer()
    currentViewer.isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)

    unmount()

    expect(currentViewer.setFullPage).toHaveBeenCalledWith(false)
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it('restores the replacement viewer when full screen ends after a handoff', () => {
    const { rerender } = render(
      <ImageViewer key="first" fullScreenHandoffKey="sequence:1" tileSources="/first.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)
    setFullscreenElement(document.body)

    rerender(
      <ImageViewer key="second" fullScreenHandoffKey="sequence:1" tileSources="/second.dzi" />,
    )
    const second = viewer()
    expect(second.setFullPage).toHaveBeenCalledWith(true)
    second.isFullPage.mockReturnValue(true)

    setFullscreenElement(null)
    act(() => document.dispatchEvent(new Event('fullscreenchange')))

    expect(second.setFullPage).toHaveBeenLastCalledWith(false)
    expect(second.element.style.width).toBe('')
    expect(second.element.style.height).toBe('')
  })

  it('hands OSD full-page fallback to the keyed replacement without browser fullscreen (#1841)', () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })
    setFullscreenElement(null)
    const { rerender } = render(
      <ImageViewer key="first" fullScreenHandoffKey="sequence:1" tileSources="/first.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)

    rerender(
      <ImageViewer key="second" fullScreenHandoffKey="sequence:1" tileSources="/second.dzi" />,
    )
    expect(viewer().setFullPage).toHaveBeenCalledWith(true)
    act(() => vi.advanceTimersByTime(0))
    expect(exitFullscreen).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('drops an unclaimed full-page fallback handoff after unmount (#1841)', () => {
    vi.useFakeTimers()
    setFullscreenElement(null)
    const { unmount } = render(
      <ImageViewer fullScreenHandoffKey="sequence:1" tileSources="/tiles.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)
    unmount()
    act(() => vi.advanceTimersByTime(0))

    render(<ImageViewer fullScreenHandoffKey="sequence:1" tileSources="/later.dzi" />)
    act(() => vi.advanceTimersByTime(0))
    expect(viewer().setFullPage).not.toHaveBeenCalledWith(true)
    vi.useRealTimers()
  })

  it('does not enter full-page mode without a pending handoff', () => {
    setFullscreenElement(document.body)
    render(<ImageViewer tileSources="/tiles.dzi" />)

    expect(viewer().setFullPage).not.toHaveBeenCalled()
  })

  it('resets rotation on home and counts only full-page entry', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)

    act(() => viewer().fire('home'))
    expect(viewer().viewport.setRotation).toHaveBeenCalledWith(0)
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ui.toolbar_action', action: 'home' }),
    )

    const before = observabilityMocks.emitEvent.mock.calls.length
    act(() => viewer().fire('full-page', { fullPage: false }))
    expect(observabilityMocks.emitEvent).toHaveBeenCalledTimes(before)
    act(() => viewer().fire('full-page', { fullPage: true }))
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'full_screen' }),
    )
  })

  it('swaps the full-page button to inward arrows while full screen', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const fpButton = viewer().fullPageButton
    const img = fpButton.element.querySelector('img') as HTMLImageElement

    expect(img.src).toContain('fullpage_rest.svg')

    viewer().isFullPage.mockReturnValue(true)
    act(() => viewer().fire('full-page', { fullPage: true }))
    expect(img.src).toContain('exitfullpage_rest.svg')
    expect(fpButton.element.title).toBe('Exit full screen')

    viewer().isFullPage.mockReturnValue(false)
    act(() => viewer().fire('full-page', { fullPage: false }))
    expect(img.src).toContain('fullpage_rest.svg')
    expect(fpButton.element.title).toBe('Full screen')
  })

  it('reports viewport state after animations finish', () => {
    const onViewportChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onViewportChange={onViewportChange} />)

    act(() => viewer().fire('animation-finish'))

    expect(onViewportChange).toHaveBeenCalledWith({ zoom: 2, x: 0.5, y: 0.4, rotation: 90 })
  })

  it('refits the Home view after resize and persists it without home telemetry', () => {
    const onViewportChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onViewportChange={onViewportChange} />)
    const v = viewer()
    const homeBounds = setViewportAtHome(v)
    act(() => v.fire('open'))
    onViewportChange.mockClear()

    act(() => v.fire('resize'))
    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
    act(() => v.fire('viewport-change'))
    expect(v.viewport.fitBounds).toHaveBeenCalledWith(homeBounds, true)
    expect(onViewportChange).toHaveBeenCalledWith({ zoom: 2, x: 0.5, y: 0.4, rotation: 0 })
    expect(observabilityMocks.emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ui.toolbar_action', action: 'home' }),
    )
  })

  it('refits when resizing during an animation toward Home', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    const homeBounds = setViewportAtHome(v)
    act(() => v.fire('open'))
    v.viewportState.current.zoom = 1
    v.viewportState.current.center = { x: 0.7, y: 0.4 }
    v.viewportState.current.rotation = 45
    act(() => v.fire('viewport-change'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).toHaveBeenCalledWith(homeBounds, true)
    expect(v.viewport.getZoom).toHaveBeenCalledWith(false)
    expect(v.viewport.getCenter).toHaveBeenCalledWith(false)
    expect(v.viewport.getRotation).toHaveBeenCalledWith(false)
  })

  it('does not refit a zoomed view after resize', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    setViewportAtHome(v)
    act(() => v.fire('open'))
    v.viewport.getZoom.mockReturnValue(4)
    act(() => v.fire('viewport-change'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('does not refit a rotated view after resize', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    setViewportAtHome(v)
    v.viewport.getRotation.mockReturnValue(90)
    act(() => v.fire('open'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('does not refit a panned view after resize', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    setViewportAtHome(v)
    act(() => v.fire('open'))
    v.viewport.getCenter.mockReturnValue({ x: 0.7, y: 0.4 })
    act(() => v.fire('viewport-change'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('does not refit a flipped view after resize', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    setViewportAtHome(v)
    act(() => v.fire('open'))
    v.viewport.getFlip.mockReturnValue(true)
    act(() => v.fire('viewport-change'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('refits the Home view after consecutive resizes', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()
    const homeBounds = setViewportAtHome(v)
    act(() => v.fire('open'))

    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
      v.fire('resize')
      v.fire('viewport-change')
    })

    expect(v.viewport.fitBounds).toHaveBeenCalledTimes(2)
    expect(v.viewport.fitBounds).toHaveBeenNthCalledWith(1, homeBounds, true)
    expect(v.viewport.fitBounds).toHaveBeenNthCalledWith(2, homeBounds, true)
  })

  it('renews tile sources once for a burst of failed tile loads and preserves the viewport', async () => {
    apiMocks.fetchImage.mockResolvedValue({
      id: 7,
      name: 'Fresh Image',
      thumb: '/thumb.jpg?tile_token=fresh',
      tile_sources: '/tiles.dzi?tile_token=fresh',
      category_id: 3,
      copyright: null,
      note: null,
      active: true,
      sort_order: 0,
      metadata_extra: null,
      version: 2,
      width: null,
      height: null,
      file_size: null,
      created_at: '',
      updated_at: '',
    })
    const onTileSourceRenewed = vi.fn()
    const { rerender } = render(
      <ImageViewer
        tileSources="/tiles.dzi?tile_token=stale"
        imageId={7}
        onTileSourceRenewed={onTileSourceRenewed}
      />,
    )
    const v = viewer()
    v.viewport.getZoom.mockReturnValue(5)
    v.viewport.getCenter.mockReturnValue({ x: 0.2, y: 0.3 })
    v.viewport.getRotation.mockReturnValue(15)

    act(() => {
      v.fire('tile-load-failed', { message: '401' })
      v.fire('tile-load-failed', { message: '401' })
    })

    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1))
    expect(apiMocks.fetchImage).toHaveBeenCalledWith(7)
    expect(v.open).toHaveBeenCalledWith('/tiles.dzi?tile_token=fresh')
    expect(onTileSourceRenewed).toHaveBeenCalledWith(
      expect.objectContaining({ tile_sources: '/tiles.dzi?tile_token=fresh' }),
    )

    rerender(
      <ImageViewer
        tileSources="/tiles.dzi?tile_token=fresh"
        imageId={7}
        onTileSourceRenewed={onTileSourceRenewed}
      />,
    )
    expect(osdState.viewers).toHaveLength(1)

    act(() => v.fire('open'))
    expect(v.viewport.zoomTo).toHaveBeenLastCalledWith(5, undefined, true)
    expect(v.viewport.panTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0.2, y: 0.3 }),
      true,
    )
    expect(v.viewport.setRotation).toHaveBeenLastCalledWith(15, true)
    act(() => {
      v.fire('resize')
      v.fire('viewport-change')
    })
    expect(v.viewport.fitBounds).not.toHaveBeenCalled()
  })

  it('preserves the live viewport across a same-image tile-source refresh (#1567)', () => {
    // A save/refetch response re-tokenizes tile_sources — reopening the
    // pyramid must not bounce the user back to the home position, and
    // existing overlays survive the same-image swap.
    const { rerender } = render(<ImageViewer tileSources="/tiles.dzi?tile_token=old" imageId={7} />)
    const v = viewer()
    act(() => v.fire('open'))
    const overlay = document.createElement('div')
    act(() => v.addOverlay(overlay))
    v.viewport.getZoom.mockReturnValue(5)
    v.viewport.getCenter.mockReturnValue({ x: 0.2, y: 0.3 })
    v.viewport.getRotation.mockReturnValue(15)
    v.viewport.zoomTo.mockClear()
    v.viewport.panTo.mockClear()
    v.viewport.setRotation.mockClear()

    rerender(<ImageViewer tileSources="/tiles.dzi?tile_token=new" imageId={7} />)

    expect(v.open).toHaveBeenCalledWith('/tiles.dzi?tile_token=new')
    expect(v.activeOverlays.has(overlay)).toBe(true)

    act(() => v.fire('open'))
    expect(v.viewport.zoomTo).toHaveBeenLastCalledWith(5, undefined, true)
    expect(v.viewport.panTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0.2, y: 0.3 }),
      true,
    )
    expect(v.viewport.setRotation).toHaveBeenLastCalledWith(15, true)
  })

  it('does not renew tile sources for non-auth loading failures', async () => {
    render(<ImageViewer tileSources="/tiles.dzi?tile_token=current" imageId={7} />)
    const v = viewer()

    act(() => {
      v.fire('tile-load-failed', {
        message: 'Tile not found',
        tileRequest: { status: 404 },
      })
      v.fire('add-item-failed', { message: 'Malformed DZI descriptor' })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })
    expect(apiMocks.fetchImage).not.toHaveBeenCalled()
  })

  it('renews after an img-backed tile failure with no observable HTTP status', async () => {
    apiMocks.fetchImage.mockResolvedValue({
      id: 7,
      name: 'Fresh Image',
      thumb: '/thumb.jpg?tile_token=fresh',
      tile_sources: '/tiles.dzi?tile_token=fresh',
      category_id: 3,
      copyright: null,
      note: null,
      active: true,
      sort_order: 0,
      metadata_extra: null,
      version: 2,
      width: null,
      height: null,
      file_size: null,
      created_at: '',
      updated_at: '',
    })
    render(<ImageViewer tileSources="/tiles.dzi?tile_token=stale" imageId={7} />)

    act(() => {
      viewer().fire('tile-load-failed', {
        message: '[downloadTileStart] Image load aborted or errored out.',
        tileRequest: null,
      })
    })

    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledWith(7))
    expect(viewer().open).toHaveBeenCalledWith('/tiles.dzi?tile_token=fresh')
  })

  it('reports a non-auth open failure without attempting token renewal', async () => {
    const onError = vi.fn()
    render(
      <ImageViewer tileSources="/tiles.dzi?tile_token=current" imageId={7} onError={onError} />,
    )

    act(() => viewer().fire('open-failed', { message: 'Malformed DZI descriptor' }))

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })
    expect(apiMocks.fetchImage).not.toHaveBeenCalled()
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'image.view.failed',
        error_message: 'Malformed DZI descriptor',
      }),
    )
    expect(observabilityMocks.emitFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'image_viewer_open_failed',
        imageId: 7,
        message: 'Malformed DZI descriptor',
      }),
    )
    expect(onError).toHaveBeenCalledWith(
      'This image could not be loaded. It may have been removed or you may not have access to it.',
    )
  })

  it('surfaces the existing error UI when tile source renewal fails', async () => {
    apiMocks.fetchImage.mockRejectedValue(new Error('forbidden'))
    const onError = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi?tile_token=stale" imageId={7} onError={onError} />)

    act(() => {
      viewer().fire('open-failed', { message: 'HTTP 401 attempting to load TileSource' })
    })

    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        'Image tiles could not be refreshed. You may no longer have access to this image.',
      ),
    )
    expect(observabilityMocks.emitFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'image_viewer_tile_token_renewal_failed' }),
    )
  })

  it('resets renewal state when switching images during a pending renewal', async () => {
    const firstRenewal = deferred<ApiImage>()
    const secondRenewal = deferred<ApiImage>()
    apiMocks.fetchImage.mockImplementation((id: number) =>
      id === 7 ? firstRenewal.promise : secondRenewal.promise,
    )
    const onTileSourceRenewed = vi.fn()
    const { rerender } = render(
      <ImageViewer
        tileSources="/image-a.dzi?tile_token=stale"
        imageId={7}
        onTileSourceRenewed={onTileSourceRenewed}
      />,
    )
    const viewerA = viewer()
    viewerA.viewport.getZoom.mockReturnValue(9)
    viewerA.viewport.getCenter.mockReturnValue({ x: 0.9, y: 0.8 })
    viewerA.viewport.getRotation.mockReturnValue(45)

    act(() => viewerA.fire('tile-load-failed', { message: '401' }))
    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledWith(7))

    rerender(
      <ImageViewer
        tileSources="/image-b.dzi?tile_token=stale"
        imageId={8}
        onTileSourceRenewed={onTileSourceRenewed}
      />,
    )
    const viewerB = viewer()
    act(() => viewerB.fire('open'))
    expect(viewerB.viewport.zoomTo).not.toHaveBeenCalled()

    act(() => viewerB.fire('tile-load-failed', { message: '401' }))
    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledWith(8))

    await act(async () => {
      firstRenewal.resolve({
        id: 7,
        name: 'Image A',
        thumb: '/thumb-a.jpg?tile_token=fresh',
        tile_sources: '/image-a.dzi?tile_token=fresh',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 2,
        width: null,
        height: null,
        file_size: null,
        created_at: '',
        updated_at: '',
      })
      await firstRenewal.promise
    })
    expect(viewerA.open).not.toHaveBeenCalled()
    expect(onTileSourceRenewed).not.toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))

    await act(async () => {
      secondRenewal.resolve({
        id: 8,
        name: 'Image B',
        thumb: '/thumb-b.jpg?tile_token=fresh',
        tile_sources: '/image-b.dzi?tile_token=fresh',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 2,
        width: null,
        height: null,
        file_size: null,
        created_at: '',
        updated_at: '',
      })
      await secondRenewal.promise
    })

    expect(viewerB.open).toHaveBeenCalledWith('/image-b.dzi?tile_token=fresh')
    expect(onTileSourceRenewed).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }))
  })
})

describe('ImageViewer selection rectangles', () => {
  it('toggles selection mode and disables mouse navigation while drawing', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const button = buttonByTooltip('Draw selection rectangle')

    act(() => button.options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenCalledWith(false)
    expect(button.element.querySelector('img')?.src).toContain('selection_active_rest.svg')

    act(() => button.options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenCalledWith(true)
    expect(button.element.querySelector('img')?.src).toContain('selection_rest.svg')
  })

  it('draws a rectangle and notifies the parent of the overlay set', () => {
    const onOverlaysChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onOverlaysChange={onOverlaysChange} />)

    drawRect()

    expect(viewer().addOverlay).toHaveBeenCalledTimes(1)
    expect(viewer().updateOverlay).toHaveBeenCalled()
    expect(onOverlaysChange).toHaveBeenCalledWith([
      { x: 0.1, y: 0.1, w: expect.closeTo(0.2), h: expect.closeTo(0.1) },
    ])
    // Selection mode auto-exits after release
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
  })

  it('preserves selection rectangles across a renewed tile-source open', async () => {
    apiMocks.fetchImage.mockResolvedValue({
      id: 7,
      name: 'Fresh Image',
      thumb: '/thumb.jpg?tile_token=fresh',
      tile_sources: '/tiles.dzi?tile_token=fresh',
      category_id: null,
      copyright: null,
      note: null,
      active: true,
      sort_order: 0,
      metadata_extra: null,
      version: 2,
      width: null,
      height: null,
      file_size: null,
      created_at: '',
      updated_at: '',
    })
    render(<ImageViewer tileSources="/tiles.dzi?tile_token=stale" imageId={7} />)
    const v = viewer()
    drawRect()
    expect(v.activeOverlays.size).toBe(1)

    act(() => {
      v.fire('tile-load-failed', {
        message: '[downloadTileStart] Image load aborted or errored out.',
        tileRequest: null,
      })
    })
    await waitFor(() => expect(v.open).toHaveBeenCalledWith('/tiles.dzi?tile_token=fresh'))
    act(() => v.fire('open'))

    expect(v.activeOverlays.size).toBe(1)
    expect(v.preserveOverlays).toBe(false)
    act(() => buttonByTooltip('Clear all selection rectangles').options.onClick())
    expect(v.activeOverlays.size).toBe(0)
  })

  it('constrains the rectangle to a square while shift is held', () => {
    const onOverlaysChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onOverlaysChange={onOverlaysChange} />)

    drawRect({ shiftKey: true })

    expect(onOverlaysChange).toHaveBeenCalledWith([
      { x: 0.1, y: 0.1, w: expect.closeTo(0.2), h: expect.closeTo(0.2) },
    ])
  })

  it('removes the phantom overlay on click without drag', () => {
    const onOverlaysChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onOverlaysChange={onOverlaysChange} />)

    drawRect({ drag: false })

    expect(viewer().removeOverlay).toHaveBeenCalledTimes(1)
    expect(onOverlaysChange).not.toHaveBeenCalled()
  })

  it('ignores presses when selection mode is inactive', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)

    act(() => {
      tracker().options.pressHandler({ position: { x: 10, y: 10 } })
      tracker().options.releaseHandler()
    })

    expect(viewer().addOverlay).not.toHaveBeenCalled()
  })

  it('marks presses inside the portaled canvas UI as preventGesture', () => {
    // The toolbar/links are portaled into viewer.container; without this guard
    // the tracker captures their presses to viewer.element, retargeting
    // pointerup/click and suppressing focus — leaving the buttons inert.
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const preProcess = tracker().options.preProcessEventHandler
    expect(preProcess).toBeDefined()

    const uiRoot = document.createElement('div')
    uiRoot.setAttribute('data-hriv-canvas-ui', '')
    const uiButton = document.createElement('button')
    uiRoot.appendChild(uiButton)

    const uiEvent = {
      originalEvent: { target: uiButton },
      preventGesture: false,
      preventDefault: true,
    }
    preProcess!(uiEvent)
    expect(uiEvent.preventGesture).toBe(true)
    expect(uiEvent.preventDefault).toBe(false)
    const nativeClick = { eventType: 'click', preventGesture: false, preventDefault: true }
    preProcess!(nativeClick)
    expect(nativeClick.preventDefault).toBe(false)

    // Targets inside viewer.canvas (the tile surface, overlays, labels) are
    // gestures; anything else in viewer.element — the OSD control dock,
    // navigator — is not, so a dock press can't start a rect or ink stroke.
    const canvasTarget = document.createElement('div')
    viewer().canvas.appendChild(canvasTarget)
    const viewerEvent = {
      eventType: 'pointerdown',
      originalEvent: { target: canvasTarget },
      preventGesture: false,
    }
    preProcess!(viewerEvent)
    expect(viewerEvent.preventGesture).toBe(false)

    const dockTarget = document.createElement('div')
    viewer().container.appendChild(dockTarget)
    const dockEvent = {
      eventType: 'pointerdown',
      originalEvent: { target: dockTarget },
      preventGesture: false,
    }
    preProcess!(dockEvent)
    expect(dockEvent.preventGesture).toBe(true)

    // Once a gesture is captured, move/up events retarget to viewer.element
    // (outside viewer.canvas); blocking them would cancel in-flight drags.
    const capturedMove = {
      eventType: 'pointermove',
      originalEvent: { target: viewer().element },
      preventGesture: false,
    }
    preProcess!(capturedMove)
    expect(capturedMove.preventGesture).toBe(false)

    const noTarget = { originalEvent: {}, preventGesture: false }
    preProcess!(noTarget)
    expect(noTarget.preventGesture).toBe(false)
  })

  it('clears all overlays and notifies the parent', () => {
    const onOverlaysChange = vi.fn()
    const onClearOverlays = vi.fn()
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        onOverlaysChange={onOverlaysChange}
        onClearOverlays={onClearOverlays}
      />,
    )
    drawRect()

    act(() => buttonByTooltip('Clear all selection rectangles').options.onClick())

    expect(viewer().removeOverlay).toHaveBeenCalledTimes(1)
    expect(onOverlaysChange).toHaveBeenLastCalledWith([])
    expect(onClearOverlays).toHaveBeenCalled()
  })

  it('does not clear overlays while they are locked', () => {
    const onClearOverlays = vi.fn()
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        canEditContent
        overlaysLocked
        onClearOverlays={onClearOverlays}
      />,
    )

    act(() => buttonByTooltip('Clear all selection rectangles').options.onClick())

    expect(onClearOverlays).not.toHaveBeenCalled()
  })

  it('hides the clear button until it can be used', () => {
    const onLockOverlays = vi.fn()
    const { rerender } = render(
      <ImageViewer tileSources="/tiles.dzi" canEditContent onLockOverlays={onLockOverlays} />,
    )
    const clearWrapper = buttonByTooltip('Clear all selection rectangles').element
      .parentElement as HTMLElement

    // Hidden before any rectangle exists.
    expect(clearWrapper.style.display).toBe('none')

    // Visible once a rectangle is drawn.
    drawRect()
    expect(clearWrapper.style.display).toBe('inline-block')

    // Hidden again after a clear empties the overlay list.
    act(() => buttonByTooltip('Clear all selection rectangles').options.onClick())
    expect(clearWrapper.style.display).toBe('none')

    // Hidden while the overlays are locked.
    drawRect()
    expect(clearWrapper.style.display).toBe('inline-block')
    rerender(
      <ImageViewer
        tileSources="/tiles.dzi"
        canEditContent
        overlaysLocked
        onLockOverlays={onLockOverlays}
      />,
    )
    expect(clearWrapper.style.display).toBe('none')
  })

  it('hides the lock button until it can be used', () => {
    const { rerender } = render(
      <ImageViewer tileSources="/tiles.dzi" canEditContent onLockOverlays={vi.fn()} />,
    )
    const lockWrapper = buttonByTooltip('Lock selection rectangles').element
      .parentElement as HTMLElement

    // Hidden before any rectangle exists.
    expect(lockWrapper.style.display).toBe('none')

    // Visible once a rectangle is drawn.
    drawRect()
    expect(lockWrapper.style.display).toBe('inline-block')

    // Hidden again after a clear empties the overlay list.
    act(() => buttonByTooltip('Clear all selection rectangles').options.onClick())
    expect(lockWrapper.style.display).toBe('none')

    // Visible while the overlays are locked.
    drawRect()
    rerender(
      <ImageViewer
        tileSources="/tiles.dzi"
        canEditContent
        overlaysLocked
        onLockOverlays={vi.fn()}
      />,
    )
    expect(lockWrapper.style.display).toBe('inline-block')
  })
})

describe('ImageViewer overlay locking', () => {
  it('locks drawn rectangles for editors', () => {
    const onLockOverlays = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent onLockOverlays={onLockOverlays} />)
    drawRect()

    act(() => buttonByTooltip('Lock selection rectangles').options.onClick())

    expect(onLockOverlays).toHaveBeenCalledWith([
      { x: 0.1, y: 0.1, w: expect.closeTo(0.2), h: expect.closeTo(0.1) },
    ])
  })

  it('unlocks overlays when they are currently locked', () => {
    const onUnlockOverlays = vi.fn()
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        canEditContent
        overlaysLocked
        onUnlockOverlays={onUnlockOverlays}
      />,
    )

    act(() => buttonByTooltip('Lock selection rectangles').options.onClick())

    expect(onUnlockOverlays).toHaveBeenCalled()
  })

  it('does not lock when no rectangles have been drawn', () => {
    const onLockOverlays = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent onLockOverlays={onLockOverlays} />)

    act(() => buttonByTooltip('Lock selection rectangles').options.onClick())

    expect(onLockOverlays).not.toHaveBeenCalled()
  })

  it('hides editor-only toolbar buttons from read-only users', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)

    expect(
      osdState.buttons.find((b) => b.options.tooltip === 'Lock selection rectangles'),
    ).toBeUndefined()
    expect(
      osdState.buttons.find((b) => b.options.tooltip.startsWith('Canvas annotations')),
    ).toBeUndefined()
  })
})

describe('ImageViewer canvas edit mode', () => {
  it('enters canvas edit mode from the toolbar and exits via the overlay cancel flow', () => {
    const onCanvasEditModeChange = vi.fn()
    render(
      <ImageViewer
        tileSources="/tiles.dzi"
        canEditContent
        onCanvasEditModeChange={onCanvasEditModeChange}
      />,
    )
    const button = buttonByTooltip('Canvas annotations (add shapes, text, links)')

    expect(screen.getByText('canvas edit: false')).toBeInTheDocument()

    act(() => button.options.onClick())
    expect(screen.getByText('canvas edit: true')).toBeInTheDocument()
    expect(viewer().setMouseNavEnabled).toHaveBeenCalledWith(false)
    expect(onCanvasEditModeChange).toHaveBeenLastCalledWith(true)

    // Toolbar exit routes through the overlay's registered cancel handler
    act(() => button.options.onClick())
    expect(screen.getByText('canvas edit: false')).toBeInTheDocument()
    expect(onCanvasEditModeChange).toHaveBeenLastCalledWith(false)
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
  })

  it('exits canvas edit mode when the overlay signals completion', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)

    act(() => buttonByTooltip('Canvas annotations (add shapes, text, links)').options.onClick())
    expect(screen.getByText('canvas edit: true')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Overlay done' }))
    expect(screen.getByText('canvas edit: false')).toBeInTheDocument()
  })

  it('marks the canvas-edit button active with the solid primary icon', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)
    const button = buttonByTooltip('Canvas annotations (add shapes, text, links)')

    act(() => button.options.onClick())
    expect(button.element.querySelector('img')?.src).toContain('canvas_edit_active_rest.svg')
  })
})

describe('ImageViewer chrome alignment', () => {
  it('bottom-aligns bottom-dock descendants so toolbar and minimap sit flush', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)
    const v = viewer()
    // The bottom-left and bottom-right docks are the first two children;
    // the top-right viewport-control dock is not bottom-aligned.
    const docks = (Array.from(v.container.children) as HTMLElement[]).slice(0, 2)
    expect(docks.length).toBeGreaterThanOrEqual(2)
    for (const dock of docks) {
      const descendants = dock.querySelectorAll<HTMLElement>('*')
      expect(descendants.length).toBeGreaterThan(0)
      descendants.forEach((el) => expect(el.style.verticalAlign).toBe('bottom'))
    }
    // The navigator/minimap sits in the bottom-right dock
    expect(v.navigator.element.style.verticalAlign).toBe('bottom')
  })
})

describe('ImageViewer magnification badge and pinch rotation', () => {
  it('shows the magnification badge when measurement config is present', () => {
    render(<ImageViewer tileSources="/tiles.dzi" measurement={{ scale: 2, unit: 'um' }} />)
    const badge = viewer().navigator.element.firstElementChild as HTMLDivElement

    expect(badge.style.display).toBe('none')
    act(() => viewer().fire('animation'))
    expect(badge.style.display).toBe('')
    expect(badge.textContent).toMatch(/X$/)
  })

  it('hides the magnification badge without measurement config', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const badge = viewer().navigator.element.firstElementChild as HTMLDivElement

    // Force the badge visible so the assertion proves updateMagnification
    // actively re-hides it rather than it never having been shown.
    badge.style.display = ''
    act(() => viewer().fire('animation'))
    expect(viewer().viewport.viewportToImageZoom).toHaveBeenCalled()
    expect(badge.style.display).toBe('none')
  })

  it('applies damped rotation once the pinch gesture activates as rotate', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const v = viewer()

    // Rotate two contact points around a center; distance stays constant so
    // the tracker arbitrates the gesture as rotation once past activation.
    const pointsAt = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return [
        { x: 100 + 50 * Math.cos(rad), y: 100 + 50 * Math.sin(rad) },
        { x: 100 - 50 * Math.cos(rad), y: 100 - 50 * Math.sin(rad) },
      ]
    }
    let last = pointsAt(0)
    for (let step = 1; step <= 4; step += 1) {
      const current = pointsAt(step * 10)
      const event = {
        gesturePoints: [
          { lastPos: last[0], currentPos: current[0] },
          { lastPos: last[1], currentPos: current[1] },
        ],
        lastDistance: 100,
        distance: 100,
        center: { x: 100, y: 100 },
        originalEvent: { timeStamp: step * 10 },
        preventDefaultRotateAction: false,
        preventDefaultZoomAction: false,
      }
      act(() => v.fire('canvas-pinch', event))
      expect(event.preventDefaultRotateAction).toBe(true)
      last = current
    }

    expect(v.viewport.rotateTo).toHaveBeenCalled()
  })

  it('ignores pinch events with fewer than two gesture points', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)

    act(() => viewer().fire('canvas-pinch', { gesturePoints: [] }))

    expect(viewer().viewport.rotateTo).not.toHaveBeenCalled()
  })
})

describe('ImageViewer object counting (#1667)', () => {
  beforeEach(() => {
    apiMocks.startCount.mockResolvedValue({
      job_id: 'j1',
      status: 'queued',
      queue_position: 0,
    })
    apiMocks.getCount.mockReturnValue(new Promise(() => {}))
    apiMocks.cancelCount.mockResolvedValue(undefined)
  })

  it('shows no count button until a selection is drawn', () => {
    render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)
    expect(viewer().container.querySelector('[aria-label^="Count objects"]')).toBeNull()
  })

  it('shows a data-hriv-canvas-ui count button on a drawn selection', () => {
    render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)
    drawRect()
    const button = viewer().container.querySelector('[aria-label="Count objects in selection 1"]')
    expect(button?.closest('[data-hriv-canvas-ui]')).not.toBeNull()
    expect(
      within(viewer().container).getByRole('button', {
        name: 'Count objects in selection 1',
      }),
    ).toBeTruthy()
  })

  it('POSTs the level-0 rect converted from the drawn viewport rect', async () => {
    render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)
    // press (10,10)px -> (0.1,0.1)vp; drag (30,20)px -> (0.3,0.2)vp
    // => rect (0.1,0.1,0.2,0.1) => image px (100,80,200,80)
    drawRect()
    fireEvent.click(
      within(viewer().container).getByRole('button', {
        name: 'Count objects in selection 1',
      }),
    )
    // Menus portal into viewer.container (visible in OSD full-page mode).
    await waitFor(() =>
      expect(within(viewer().container).getByRole('menuitem', { name: /Cells/ })).toBeTruthy(),
    )
    fireEvent.click(within(viewer().container).getByRole('menuitem', { name: /Cells/ }))
    await waitFor(() =>
      expect(apiMocks.startCount).toHaveBeenCalledWith(7, 'cells', {
        x: 100,
        y: 80,
        width: 200,
        height: 80,
      }),
    )
  })

  it('clear-all cancels the selection job', async () => {
    render(<ImageViewer tileSources="/tiles.dzi" imageId={7} />)
    drawRect()
    fireEvent.click(
      within(viewer().container).getByRole('button', {
        name: 'Count objects in selection 1',
      }),
    )
    fireEvent.click(await within(viewer().container).findByRole('menuitem', { name: /Cells/ }))
    await waitFor(() => expect(apiMocks.startCount).toHaveBeenCalled())
    await waitFor(() =>
      expect(within(viewer().container).getByText(/Counting…|Queued/)).toBeTruthy(),
    )
    act(() => {
      buttonByTooltip('Clear all selection rectangles').options.onClick()
    })
    await waitFor(() => expect(apiMocks.cancelCount).toHaveBeenCalledWith('j1', undefined))
    expect(
      within(viewer().container).queryByRole('button', {
        name: 'Count objects in selection 1',
      }),
    ).toBeNull()
  })
})

describe('ImageViewer presentation tools (#1876)', () => {
  const enterFullPage = () => {
    viewer().isFullPage.mockReturnValue(true)
    act(() => viewer().fire('full-page', { fullPage: true }))
  }
  const exitFullPage = () => {
    viewer().isFullPage.mockReturnValue(false)
    act(() => viewer().fire('full-page', { fullPage: false }))
  }
  const presentationButtonWrapper = (tooltip: string) =>
    buttonByTooltip(tooltip).element.parentElement as HTMLElement
  const drawInkStroke = () => {
    act(() => {
      tracker().options.pressHandler({ position: { x: 10, y: 10 } })
      tracker().options.dragHandler({ position: { x: 40, y: 30 } })
      tracker().options.releaseHandler()
    })
  }

  it('disables mouse click-to-zoom while keeping scroll zoom', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    expect(osdState.viewerOptions[0]).toMatchObject({
      gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false },
    })
  })

  it('hides the zoom/rotation buttons only while in full-page mode (#1877)', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    const navButtons = [
      viewer().zoomInButton.element,
      viewer().zoomOutButton.element,
      viewer().rotateLeftButton.element,
      viewer().rotateRightButton.element,
    ]

    for (const el of navButtons) expect(el.style.display).toBe('inline-block')

    enterFullPage()
    for (const el of navButtons) expect(el.style.display).toBe('none')

    // Restore the inline-block that ControlDock.addControl sets — a blank
    // display would collapse the buttons into block-level stacking (#1881).
    exitFullPage()
    for (const el of navButtons) expect(el.style.display).toBe('inline-block')
  })

  it('hides the canvas-edit pencil only while in full-page mode', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)
    const pencil = buttonByTooltip('Canvas annotations (add shapes, text, links)').element
    expect(pencil.style.display).toBe('inline-block')

    enterFullPage()
    expect(pencil.style.display).toBe('none')

    exitFullPage()
    expect(pencil.style.display).toBe('inline-block')
  })

  it('docks lock/clear next to the selection button, pencil-edit last', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent onLockOverlays={vi.fn()} />)
    const docked = viewer().addControl.mock.calls.map((call) => call[0] as HTMLElement)
    const dockIndex = (tooltip: string) => {
      const el = buttonByTooltip(tooltip).element
      return docked.findIndex((d) => d === el || d.contains(el))
    }
    const selection = dockIndex('Draw selection rectangle')
    const lock = dockIndex('Lock selection rectangles')
    const clear = dockIndex('Clear all selection rectangles')
    const canvasEdit = dockIndex('Canvas annotations (add shapes, text, links)')
    const laser = dockIndex('Laser pointer')
    const ink = dockIndex('Freehand ink')
    expect(selection).toBeGreaterThanOrEqual(0)
    expect(lock).toBeGreaterThan(selection)
    expect(clear).toBeGreaterThan(lock)
    expect(laser).toBeGreaterThan(clear)
    expect(ink).toBeGreaterThan(laser)
    // The pencil is always the final icon in the toolbar.
    expect(canvasEdit).toBeGreaterThan(ink)
  })

  it('binds H/B/L/I keys to the toolbar, gating laser/ink on full-page', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    document.body.appendChild(viewer().element)
    const press = (key: string, target: EventTarget = viewer().canvas) => {
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }

    // Home + selection work in normal view; laser/ink only in full-page.
    // H runs the same 'home' handler as the OSD button: rotation resets.
    press('h')
    expect(viewer().viewport.goHome).toHaveBeenCalled()
    expect(viewer().viewport.setRotation).toHaveBeenCalledWith(0)
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'home' }),
    )
    press('b')
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)
    press('b')
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)

    press('l')
    press('i')
    expect(viewer().canvas.style.cursor).toBe('')

    enterFullPage()
    press('i')
    expect(viewer().canvas.style.cursor).toBe('crosshair')
    press('l')
    expect(viewer().canvas.style.cursor).toBe('none')
    press('l')
    expect(viewer().canvas.style.cursor).toBe('')
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ink_on' }),
    )
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_on' }),
    )
  })

  it('ignores toolbar keys while typing or over another element', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    document.body.appendChild(viewer().element)
    enterFullPage()
    const input = document.createElement('input')
    viewer().container.appendChild(input)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    })
    // No laser arm: target is an input field.
    expect(viewer().canvas.style.cursor).toBe('none') // auto-armed on entry
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))
    expect(viewer().canvas.style.cursor).toBe('none') // still laser, no ink
  })

  it('routes toolbar keys to the focused viewer, not a hovered one', () => {
    render(<ImageViewer key="a" tileSources="/a.dzi" />)
    const first = viewer()
    render(<ImageViewer key="b" tileSources="/b.dzi" />)
    const second = viewer()
    document.body.appendChild(first.element)
    document.body.appendChild(second.element)
    // Pointer hovers pane B while the key event belongs to pane A.
    vi.spyOn(second.container, 'matches').mockImplementation((sel) => sel === ':hover')

    act(() => {
      first.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    })
    expect(first.setMouseNavEnabled).toHaveBeenLastCalledWith(false)
    expect(second.setMouseNavEnabled).not.toHaveBeenCalledWith(false)
  })

  it('shows pointer buttons and auto-arms the laser only in full-page mode', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    expect(presentationButtonWrapper('Laser pointer').style.display).toBe('none')
    expect(presentationButtonWrapper('Freehand ink').style.display).toBe('none')

    enterFullPage()
    expect(presentationButtonWrapper('Laser pointer').style.display).toBe('inline-block')
    expect(presentationButtonWrapper('Freehand ink').style.display).toBe('inline-block')
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ui.toolbar_action', action: 'laser_pointer_on' }),
    )
    expect(buttonByTooltip('Laser pointer').element.querySelector('img')?.src).toContain(
      'laser_pointer_active_rest.svg',
    )
    expect(viewer().canvas.style.cursor).toBe('none')

    exitFullPage()
    expect(presentationButtonWrapper('Laser pointer').style.display).toBe('none')
    expect(viewer().canvas.style.cursor).toBe('')
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_off' }),
    )
  })

  it('arms the laser through the browser-fullscreen handoff path', () => {
    setFullscreenElement(document.body)
    const { rerender } = render(
      <ImageViewer key="first" fullScreenHandoffKey="sequence:1" tileSources="/first.dzi" />,
    )
    viewer().isFullPage.mockReturnValue(true)

    rerender(
      <ImageViewer key="second" fullScreenHandoffKey="sequence:1" tileSources="/second.dzi" />,
    )
    const second = viewer()
    // The claimed handoff calls setFullPage(true) during construction; the
    // initial presentation sync must arm the laser without a 'full-page' event.
    expect(second.setFullPage).toHaveBeenCalledWith(true)
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_on' }),
    )
  })

  it('positions the laser dot on pointer move and ages the trail out', () => {
    vi.useFakeTimers()
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    const laser = viewer().canvas.querySelector('[data-hriv-laser]') as SVGGElement
    // Hidden until the first move so no stale origin dot shows.
    expect(laser.getAttribute('display')).toBe('none')

    act(() => tracker().options.moveHandler?.({ position: { x: 40, y: 50 } }))
    expect(laser.getAttribute('display')).toBe('')
    expect(laser.getAttribute('transform')).toBe('translate(40.0 50.0)')

    act(() => {
      vi.advanceTimersByTime(600)
    })
    const trailOpacities = Array.from(
      viewer().canvas.querySelectorAll('[data-hriv-laser-trail] circle'),
    ).map((c) => c.getAttribute('opacity'))
    expect(trailOpacities.every((o) => o === '0')).toBe(true)
    vi.useRealTimers()
  })

  it('hides the laser dot when the pointer leaves the viewer', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => tracker().options.moveHandler?.({ position: { x: 40, y: 50 } }))
    const laser = viewer().canvas.querySelector('[data-hriv-laser]') as SVGGElement
    expect(laser.getAttribute('display')).toBe('')

    act(() => tracker().options.leaveHandler?.())
    expect(laser.getAttribute('display')).toBe('none')
  })

  it('draws a cyan ink stroke anchored to the image', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)
    expect(viewer().canvas.style.cursor).toBe('crosshair')

    drawInkStroke()
    const path = viewer().canvas.querySelector('[data-hriv-ink] path') as SVGPathElement
    expect(path).not.toBeNull()
    expect(path.getAttribute('stroke')).toBe('#00E5FF')
    expect(path.getAttribute('d')).toBe('M10.0 10.0 L40.0 30.0')

    act(() => buttonByTooltip('Freehand ink').options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
    expect(viewer().canvas.style.cursor).toBe('')
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ink_on' }),
    )
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ink_off' }),
    )
  })

  it('reprojects ink strokes when the viewport changes', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    drawInkStroke()
    const path = viewer().canvas.querySelector('[data-hriv-ink] path') as SVGPathElement

    viewer().viewport.pixelFromPoint.mockImplementation((p: { x: number; y: number }) => ({
      x: p.x * 50,
      y: p.y * 50,
    }))
    act(() => viewer().fire('animation'))
    expect(path.getAttribute('d')).toBe('M5.0 5.0 L20.0 15.0')
  })

  it('renders a lone-point stroke as a round-capped dot', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    act(() => {
      tracker().options.pressHandler({ position: { x: 10, y: 10 } })
      tracker().options.releaseHandler()
    })
    const path = viewer().canvas.querySelector('[data-hriv-ink] path') as SVGPathElement
    expect(path.getAttribute('d')).toBe('M10.0 10.0 L10.0 10.0')
  })

  it('fades each stroke out after ten seconds', () => {
    vi.useFakeTimers()
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    drawInkStroke()
    const inkGroup = viewer().canvas.querySelector('[data-hriv-ink]') as SVGGElement
    const path = () => inkGroup.querySelector('path')
    expect(path()).not.toBeNull()

    act(() => vi.advanceTimersByTime(8_500))
    expect(Number(path()!.getAttribute('opacity'))).toBeCloseTo(0.75, 1)

    act(() => vi.advanceTimersByTime(2_000))
    expect(path()).toBeNull()
    vi.useRealTimers()
  })

  it('clears all ink on full-page exit', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    drawInkStroke()
    const inkGroup = viewer().canvas.querySelector('[data-hriv-ink]') as SVGGElement
    expect(inkGroup.querySelector('path')).not.toBeNull()

    exitFullPage()
    expect(inkGroup.querySelector('path')).toBeNull()
    expect(viewer().canvas.style.cursor).toBe('')
  })

  it('disarms selection mode and the laser as mutually exclusive modes', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()

    // Entering selection mode disarms the auto-armed laser.
    act(() => buttonByTooltip('Draw selection rectangle').options.onClick())
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_off' }),
    )
    expect(viewer().canvas.style.cursor).toBe('')
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)

    // Arming ink disarms selection (icon restored) and keeps nav disabled.
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    expect(buttonByTooltip('Draw selection rectangle').element.querySelector('img')?.src).toContain(
      'selection_rest.svg',
    )
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)

    // Arming the laser restores navigation (the laser must not block pan/zoom).
    act(() => buttonByTooltip('Laser pointer').options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(true)
    expect(viewer().canvas.style.cursor).toBe('none')
  })

  it('disarms the laser when canvas edit mode is entered', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)
    enterFullPage()
    act(() => buttonByTooltip('Canvas annotations (add shapes, text, links)').options.onClick())
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_off' }),
    )
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)
  })

  it('does not draw ink strokes unless the ink tool is armed', () => {
    render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage() // laser armed, not ink
    act(() => {
      tracker().options.pressHandler({ position: { x: 10, y: 10 } })
      tracker().options.dragHandler({ position: { x: 40, y: 30 } })
      tracker().options.releaseHandler()
    })
    expect(viewer().canvas.querySelector('[data-hriv-ink] path')).toBeNull()
  })

  it('never arms a pointer tool over a dirty canvas draft', () => {
    render(<ImageViewer tileSources="/tiles.dzi" canEditContent />)
    // Enter canvas edit mode, then full-page: annotation editing works in
    // full-page too, so entry must not tear it down to arm the laser.
    act(() => buttonByTooltip('Canvas annotations (add shapes, text, links)').options.onClick())
    canvasOverlayMockState.cancelKeepsEditing = true
    enterFullPage()
    expect(presentationButtonWrapper('Laser pointer').style.display).toBe('inline-block')
    expect(observabilityMocks.emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'laser_pointer_on' }),
    )

    // Pressing ink opens the discard prompt; answering "Keep editing" leaves
    // the tool disarmed instead of fighting the Fabric canvas for input.
    act(() => buttonByTooltip('Freehand ink').options.onClick())
    expect(viewer().canvas.style.cursor).not.toBe('crosshair')
    expect(observabilityMocks.emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ink_on' }),
    )

    // When the draft is later discarded and edit mode exits, the queued ink
    // tool arms — still inside full-page.
    act(() => {
      screen.getByText('Overlay done').click()
    })
    expect(observabilityMocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ink_on' }),
    )
    expect(viewer().canvas.style.cursor).toBe('crosshair')
    expect(viewer().setMouseNavEnabled).toHaveBeenLastCalledWith(false)
  })

  it('cleans up the layer, ticker and cursor on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(<ImageViewer tileSources="/tiles.dzi" />)
    enterFullPage()
    act(() => tracker().options.moveHandler?.({ position: { x: 5, y: 5 } }))
    const canvas = viewer().canvas
    expect(canvas.querySelector('[data-hriv-presentation-layer]')).not.toBeNull()

    unmount()
    expect(canvas.querySelector('[data-hriv-presentation-layer]')).toBeNull()
    expect(canvas.style.cursor).toBe('')
    vi.useRealTimers()
  })
})
