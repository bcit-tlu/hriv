import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import OpenSeadragon from 'openseadragon'
import type { InuksukView } from '../types'
import { adjustInuksukPixelForFlip, navigateToInuksuk } from '../inuksukViewport'

export interface InuksukMarker extends InuksukView {
  id: number
  title: string
  markerVisible?: boolean
  labelVisible?: boolean
}

export default function InuksukMarkersLayer({
  viewer,
  items,
  selectedId,
  onSelect,
}: {
  viewer: OpenSeadragon.Viewer
  items: InuksukMarker[]
  selectedId?: number | null
  onSelect?: (item: InuksukMarker) => void
}) {
  const anchors = useRef(new Map<number, HTMLDivElement>())
  useLayoutEffect(() => {
    const position = () => {
      for (const item of items) {
        const element = anchors.current.get(item.id)
        if (!element) continue
        const point = adjustInuksukPixelForFlip(
          viewer,
          viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(item.x, item.y), true),
        )
        element.style.left = point.x + 'px'
        element.style.top = point.y + 'px'
      }
    }
    const events = ['animation', 'animation-finish', 'open', 'resize', 'rotate', 'flip'] as const
    events.forEach((event) => viewer.addHandler(event, position))
    position()
    return () => events.forEach((event) => viewer.removeHandler(event, position))
  }, [viewer, items])
  return createPortal(
    <div
      data-hriv-canvas-ui
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 21 }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          data-inuksuk-id={item.id}
          ref={(element) => {
            if (element) anchors.current.set(item.id, element)
            else anchors.current.delete(item.id)
          }}
          style={{ position: 'absolute', width: 0, height: 0 }}
        >
          {item.markerVisible !== false && (
            <button
              type="button"
              aria-label={`View Inuksuk: ${item.title}`}
              aria-pressed={selectedId === item.id}
              onClick={(event) => {
                event.stopPropagation()
                navigateToInuksuk(viewer, item)
                onSelect?.(item)
              }}
              style={{
                position: 'absolute',
                left: -13.5,
                top: -13.5,
                width: 27,
                height: 27,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                cursor: 'pointer',
                color: '#1565c0',
                border: 0,
                borderRadius: '50%',
                boxShadow: '0 1px 4px #0005',
                background: 'transparent',
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}inuksuk-marker.svg`}
                width={27}
                height={27}
                alt=""
                draggable={false}
              />
            </button>
          )}
          {item.labelVisible !== false && (
            <span
              style={{
                position: 'absolute',
                left: 21,
                top: -12,
                whiteSpace: 'nowrap',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                borderRadius: 4,
                font: '500 13px/24px Roboto, sans-serif',
                padding: '0 7px',
                color: '#fff',
                background: selectedId === item.id ? '#1565c0' : '#212121e6',
              }}
            >
              {item.title}
            </span>
          )}
        </div>
      ))}
    </div>,
    viewer.container,
  )
}
