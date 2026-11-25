/**
 * Type augmentations for OpenSeadragon 6.x APIs not yet covered by
 * @types/openseadragon (currently pinned to 5.x).
 *
 * Remove this file once @types/openseadragon ships a 6.x release.
 */
import 'openseadragon'

declare module 'openseadragon' {
  interface Options {
    /** Show rotate-left / rotate-right buttons in the toolbar. */
    showRotationControl?: boolean
  }

  interface GestureSettings {
    /** Enable pinch-rotate gesture on touch devices. */
    pinchRotate?: boolean
  }

  interface Viewer {
    /** Preserve existing overlays when open() synchronously closes the current source. */
    preserveOverlays: boolean
    /** Toolbar fullscreen Button created by showFullPageControl. */
    fullPageButton?: Button
    /** Toolbar zoom-in/out Buttons created by showZoomControl. */
    zoomInButton?: Button
    zoomOutButton?: Button
    /** Toolbar rotate-left/right Buttons created by showRotationControl. */
    rotateLeftButton?: Button
    rotateRightButton?: Button
  }

  /**
   * Fullscreen helpers OSD copies onto the namespace (`$.extend($, fullScreenApi)`),
   * normalizing the standard and vendor-prefixed APIs. The bundled types only
   * declare them under `fullScreenApi`.
   */
  function isFullScreen(): boolean
  function exitFullScreen(): void
  const fullScreenEventName: string

  /**
   * Drag and release tracker events carry a `position` property at runtime
   * but @types/openseadragon only declares it on PointerMouseTrackerEvent.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface MouseTrackerEvent<T extends Event = Event> {
    position?: Point | undefined
  }
}
