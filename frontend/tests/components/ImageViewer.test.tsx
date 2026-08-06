/**
 * Unit tests for ImageViewer's OpenSeadragon configuration.
 *
 * The viewer itself needs a real browser (canvas, layout, tile loading), so
 * these tests deliberately cover only the *options* handed to OpenSeadragon —
 * the mobile navigator placement and behaviour, which are easy to regress and
 * invisible until someone opens the page on a phone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import useMediaQuery from '@mui/material/useMediaQuery'

vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)

/** Captures the options object passed to the OpenSeadragon constructor. */
const osdOptions: Record<string, unknown>[] = []

vi.mock('openseadragon', () => {
  const noop = () => {}
  const makeViewer = () => ({
    world: { getItemAt: () => null },
    canvas: document.createElement('div'),
    element: document.createElement('div'),
    navigator: { element: document.createElement('div') },
    viewport: {
      getZoom: () => 1,
      getCenter: () => ({ x: 0, y: 0 }),
      getRotation: () => 0,
      viewportToImageZoom: () => 1,
      zoomTo: noop,
      panTo: noop,
      setRotation: noop,
      goHome: noop,
      zoomBy: noop,
      applyConstraints: noop,
    },
    addHandler: noop,
    removeHandler: noop,
    addOnceHandler: noop,
    addControl: noop,
    removeOverlay: noop,
    addOverlay: noop,
    updateOverlay: noop,
    setMouseNavEnabled: noop,
    destroy: noop,
  })

  function OpenSeadragon(options: Record<string, unknown>) {
    osdOptions.push(options)
    return makeViewer()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function Button(this: any) {
    this.element = document.createElement('div')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MouseTracker(this: any) {
    this.destroy = noop
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function Point(this: any, x: number, y: number) {
    this.x = x
    this.y = y
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function Rect(this: any, x: number, y: number, width: number, height: number) {
    Object.assign(this, { x, y, width, height })
  }

  Object.assign(OpenSeadragon, {
    Button,
    MouseTracker,
    Point,
    Rect,
    ControlAnchor: { BOTTOM_LEFT: 'BOTTOM_LEFT' },
  })

  return { default: OpenSeadragon, ...OpenSeadragon }
})

import ImageViewer from '../../src/components/ImageViewer'

function lastOptions() {
  return osdOptions[osdOptions.length - 1]
}

const HINT = 'Use two fingers to move and zoom the image'

/**
 * jsdom implements neither `Touch` nor `TouchEvent`, so build a plain Event and
 * attach the only property the handler reads.
 */
function fireTouch(el: Element, type: 'touchstart' | 'touchend', fingers: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: Array.from({ length: fingers }, () => ({})) })
  fireEvent(el, event)
}

describe('ImageViewer OpenSeadragon options', () => {
  beforeEach(() => {
    osdOptions.length = 0
  })
  afterEach(() => {
    mockUseMediaQuery.mockReset()
    mockUseMediaQuery.mockReturnValue(false)
  })

  describe('mobile', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })

    it('puts the mini-map top-left at an explicit, touch-sized box', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)

      const opts = lastOptions()
      expect(opts.navigatorPosition).toBe('TOP_LEFT')
      // An explicit size overrides navigatorSizeRatio, so the map stays usable
      // on small phones instead of scaling down with the viewport.
      expect(opts.navigatorWidth).toBe(92)
      expect(opts.navigatorHeight).toBe(70)
      expect(opts.navigatorSizeRatio).toBeUndefined()
    })

    it('keeps the mini-map pinned — a touch screen has no hover to un-fade it', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)

      expect(lastOptions().navigatorAutoFade).toBe(false)
    })

    // Cooperative gestures: a lone finger belongs to the page, not the viewer,
    // so an accidental touch while scrolling doesn't trap the user.
    it('leaves single-finger drag to the browser so the page keeps scrolling', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)

      const touch = lastOptions().gestureSettingsTouch as Record<string, unknown>
      expect(touch.dragToPan).toBe(false)
      expect(touch.flickEnabled).toBe(false)
      // Two-finger interaction must still work — pinch pans as well as zooms.
      expect(touch.pinchToZoom).toBe(true)
      expect(touch.pinchRotate).toBe(true)
    })

    it('shows the two-finger hint when a lone finger lands on the image', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)
      const hint = screen.getByText(HINT)

      // Hidden until touched.
      expect(hint.parentElement).toHaveStyle({ visibility: 'hidden' })

      fireTouch(screen.getByTestId('osd-container'), 'touchstart', 1)

      expect(hint.parentElement).not.toHaveStyle({ visibility: 'hidden' })
    })

    it('dismisses the hint as soon as a second finger arrives', async () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)
      const container = screen.getByTestId('osd-container')
      const hint = screen.getByText(HINT)

      fireTouch(container, 'touchstart', 1)
      expect(hint.parentElement).not.toHaveStyle({ visibility: 'hidden' })

      // Two fingers means the user is deliberately driving the viewer. The
      // overlay fades rather than snapping, so wait out the exit transition.
      fireTouch(container, 'touchstart', 2)
      await waitFor(() => {
        expect(hint.parentElement).toHaveStyle({ visibility: 'hidden' })
      })
    })

    it('never lets the hint intercept the gesture it describes', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)
      expect(screen.getByText(HINT).parentElement).toHaveStyle({ pointerEvents: 'none' })
    })

    it('hides the native control cluster in favour of the custom pill', () => {
      render(<ImageViewer tileSources="/tiles.dzi" />)

      expect(lastOptions().showNavigationControl).toBe(false)
    })
  })

  describe('desktop', () => {
    it('keeps the mini-map bottom-right, ratio-sized and auto-fading', () => {
      mockUseMediaQuery.mockReturnValue(false)
      render(<ImageViewer tileSources="/tiles.dzi" />)

      const opts = lastOptions()
      expect(opts.navigatorPosition).toBe('BOTTOM_RIGHT')
      expect(opts.navigatorSizeRatio).toBe(0.15)
      expect(opts.navigatorWidth).toBeUndefined()
      expect(opts.navigatorAutoFade).toBe(true)
      expect(opts.showNavigationControl).toBe(true)
    })

    it('renders no two-finger hint at all', () => {
      mockUseMediaQuery.mockReturnValue(false)
      render(<ImageViewer tileSources="/tiles.dzi" />)

      expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    })

    it('keeps single-finger drag panning the image (no cooperative gestures)', () => {
      mockUseMediaQuery.mockReturnValue(false)
      render(<ImageViewer tileSources="/tiles.dzi" />)

      const touch = lastOptions().gestureSettingsTouch as Record<string, unknown>
      // Unset means OpenSeadragon's default of true — desktop is untouched.
      expect(touch.dragToPan).toBeUndefined()
    })
  })
})
