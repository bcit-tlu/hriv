/**
 * Tests for the ImageViewer component.
 *
 * OpenSeadragon requires a real canvas/WebGL, so the whole module is mocked
 * with a recording fake: the viewer captures event handlers, controls, and
 * overlays; Button and MouseTracker capture their handler options so tests
 * can drive toolbar clicks and selection-rectangle gestures directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

interface MockButton {
  options: {
    tooltip: string
    onClick: () => void
  }
  element: HTMLDivElement
}

interface MockTrackerOptions {
  pressHandler: (event: { position?: { x: number; y: number } }) => void
  dragHandler: (event: {
    position?: { x: number; y: number }
    originalEvent?: { shiftKey?: boolean }
  }) => void
  releaseHandler: () => void
}

interface MockViewer {
  element: HTMLDivElement
  container: HTMLDivElement
  canvas: HTMLDivElement
  navigator: { element: HTMLDivElement }
  world: { getItemAt: ReturnType<typeof vi.fn> }
  viewport: {
    getZoom: ReturnType<typeof vi.fn>
    getCenter: ReturnType<typeof vi.fn>
    getRotation: ReturnType<typeof vi.fn>
    setRotation: ReturnType<typeof vi.fn>
    rotateTo: ReturnType<typeof vi.fn>
    zoomTo: ReturnType<typeof vi.fn>
    panTo: ReturnType<typeof vi.fn>
    pixelFromPoint: ReturnType<typeof vi.fn>
    pointFromPixel: ReturnType<typeof vi.fn>
    viewportToImageZoom: ReturnType<typeof vi.fn>
  }
  addHandler: ReturnType<typeof vi.fn>
  addOnceHandler: ReturnType<typeof vi.fn>
  addControl: ReturnType<typeof vi.fn>
  addOverlay: ReturnType<typeof vi.fn>
  updateOverlay: ReturnType<typeof vi.fn>
  removeOverlay: ReturnType<typeof vi.fn>
  setMouseNavEnabled: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  preserveOverlays: boolean
  activeOverlays: Set<HTMLElement>
  fire: (event: string, payload?: unknown) => void
}

const osdState = vi.hoisted(() => ({
  viewers: [] as MockViewer[],
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
  fetchImage: vi.fn(),
  userMessage: vi.fn((_err: unknown, fallback: string) => fallback),
}))

vi.mock('../../src/observability', () => observabilityMocks)

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchImage: apiMocks.fetchImage,
    userMessage: apiMocks.userMessage,
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
    const activeOverlays = new Set<HTMLElement>()
    const viewer: MockViewer = {
      element: document.createElement('div'),
      container,
      canvas: document.createElement('div'),
      navigator: { element: document.createElement('div') },
      world: {
        getItemAt: vi.fn(() => ({ getContentSize: () => ({ x: 1000, y: 800 }) })),
      },
      viewport: {
        getZoom: vi.fn(() => 2),
        getCenter: vi.fn(() => ({ x: 0.5, y: 0.4 })),
        getRotation: vi.fn(() => 90),
        setRotation: vi.fn(),
        rotateTo: vi.fn(),
        zoomTo: vi.fn(),
        panTo: vi.fn(),
        pixelFromPoint: vi.fn((p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 })),
        pointFromPixel: vi.fn((p: { x: number; y: number }) => ({ x: p.x / 100, y: p.y / 100 })),
        viewportToImageZoom: vi.fn((zoom: number) => zoom * 0.001),
      },
      addHandler: vi.fn((event: string, handler: (event: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      }),
      addOnceHandler: vi.fn((event: string, handler: (event: unknown) => void) => {
        onceHandlers.set(event, [...(onceHandlers.get(event) ?? []), handler])
      }),
      addControl: vi.fn((el: HTMLElement) => container.appendChild(el)),
      addOverlay: vi.fn((element: HTMLElement) => activeOverlays.add(element)),
      updateOverlay: vi.fn(),
      removeOverlay: vi.fn((element: HTMLElement) => activeOverlays.delete(element)),
      setMouseNavEnabled: vi.fn(),
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
    return viewer
  }

  const OSD = () => {
    if (osdState.initError) throw osdState.initError
    const viewer = makeViewer()
    osdState.viewers.push(viewer)
    return viewer
  }
  OSD.Point = OSDPoint
  OSD.Rect = OSDRect
  OSD.Button = OSDButton
  OSD.MouseTracker = OSDMouseTracker
  OSD.ControlAnchor = { BOTTOM_LEFT: 3 }
  return { default: OSD }
})

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
    registerCancelHandler(async () => onEditModeChange(false))
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
import type { ApiImage } from '../../src/api'
import { resetTileTokenRenewalCacheForTests } from '../../src/tileTokenRenewal'

const viewer = () => osdState.viewers[osdState.viewers.length - 1]
const buttonByTooltip = (tooltip: string) => {
  const button = osdState.buttons.find((b) => b.options.tooltip === tooltip)
  if (!button) throw new Error(`No toolbar button with tooltip: ${tooltip}`)
  return button
}
const tracker = () => osdState.trackers[osdState.trackers.length - 1]

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
  osdState.viewers.length = 0
  osdState.buttons.length = 0
  osdState.trackers.length = 0
  osdState.initError = null
  resetTileTokenRenewalCacheForTests()
  vi.useRealTimers()
  vi.clearAllMocks()
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

  it('reports viewport state after animations finish', () => {
    const onViewportChange = vi.fn()
    render(<ImageViewer tileSources="/tiles.dzi" onViewportChange={onViewportChange} />)

    act(() => viewer().fire('animation-finish'))

    expect(onViewportChange).toHaveBeenCalledWith({ zoom: 2, x: 0.5, y: 0.4, rotation: 90 })
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
    render(<ImageViewer tileSources="/tiles.dzi?tile_token=current" imageId={7} />)

    act(() => viewer().fire('open-failed', { message: 'Malformed DZI descriptor' }))

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })
    expect(apiMocks.fetchImage).not.toHaveBeenCalled()
    expect(observabilityMocks.emitFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'image_viewer_open_failed', imageId: 7 }),
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
    expect(button.element.style.outline).toBe('2px solid red')

    act(() => button.options.onClick())
    expect(viewer().setMouseNavEnabled).toHaveBeenCalledWith(true)
    expect(button.element.style.outline).toBe('none')
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
