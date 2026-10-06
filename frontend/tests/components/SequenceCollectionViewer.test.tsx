/**
 * Tests for SequenceCollectionViewer (#1416).
 *
 * ImageViewer is mocked at the component boundary so tests can assert the
 * read-only prop set and drive `onError`/`onTileSourceRenewed` directly.
 * `DragDropProvider` is wrapped (not mocked) to capture `onDragEnd`, so the
 * real @dnd-kit `move()` semantics run against synthetic operations that
 * carry the projected-index fields the helper commits on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'

import type { Collection, ImageItem } from '../../src/types'
import { makeCollection, makeImage } from '../helpers/fixtures'
import SequenceCollectionViewer, {
  type SequenceCollectionViewerProps,
} from '../../src/components/SequenceCollectionViewer'

// ── ImageViewer mock — records the latest props ─────────────────────────
let lastViewerProps: Record<string, unknown> | null = null
vi.mock('../../src/components/ImageViewer', () => ({
  default: (props: Record<string, unknown>) => {
    lastViewerProps = props
    return <div data-testid="image-viewer" data-image-id={String(props.imageId)} />
  },
}))

// ── DragDropProvider wrapper — captures onDragEnd for direct invocation ──
type SortableMeta = { index?: number; initialIndex?: number; group?: string }
type DragEndHandler = (event: {
  operation: {
    source: ({ id: string | number } & SortableMeta) | null
    target: ({ id: string | number } & SortableMeta) | null
    canceled: boolean
  }
}) => void | Promise<void>

let capturedOnDragEnd: DragEndHandler | undefined

vi.mock('@dnd-kit/react', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/react')>('@dnd-kit/react')
  return {
    ...actual,
    DragDropProvider: (props: Record<string, unknown>) => {
      capturedOnDragEnd = props.onDragEnd as DragEndHandler | undefined
      const ActualProvider = actual.DragDropProvider as React.ComponentType<Record<string, unknown>>
      return <ActualProvider {...props} />
    },
  }
})

function images(count: number): ImageItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeImage({ id: 100 + i, name: `Slice ${i + 1}`, sortOrder: i }),
  )
}

function seqCollection(overrides: Partial<Collection> = {}): Collection {
  return makeCollection({
    type: 'sequence',
    images: images(3),
    ...overrides,
  })
}

function renderViewer(overrides: Partial<SequenceCollectionViewerProps> = {}) {
  const props: SequenceCollectionViewerProps = {
    collection: seqCollection(),
    itemId: null,
    onSelectItem: vi.fn(),
    onOpenImage: vi.fn(),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onImageRenewed: vi.fn(),
    onError: vi.fn(),
    reordering: false,
    onReorderingChange: vi.fn(),
    ...overrides,
  }
  return { ...render(<SequenceCollectionViewer {...props} />), props }
}

beforeEach(() => {
  lastViewerProps = null
  capturedOnDragEnd = undefined
})

describe('SequenceCollectionViewer', () => {
  it('renders the first image and position when no item is selected', () => {
    renderViewer()
    expect(screen.getByTestId('image-viewer')).toHaveAttribute('data-image-id', '100')
    expect(screen.getByTestId('sequence-position')).toHaveTextContent('1 of 3')
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next image' })).toBeEnabled()
  })

  it('opens on the image named by ?item=', () => {
    renderViewer({ itemId: 101 })
    expect(screen.getByTestId('image-viewer')).toHaveAttribute('data-image-id', '101')
    expect(screen.getByTestId('sequence-position')).toHaveTextContent('2 of 3')
  })

  it('falls back to the first image when ?item= is not a visible member', () => {
    renderViewer({ itemId: 999 })
    expect(screen.getByTestId('image-viewer')).toHaveAttribute('data-image-id', '100')
  })

  it('navigates with Previous and Next buttons', () => {
    const { props } = renderViewer({ itemId: 101 })
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(props.onSelectItem).toHaveBeenCalledWith(102)
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(props.onSelectItem).toHaveBeenCalledWith(100)
  })

  it('disables Previous on the first image and Next on the last', () => {
    renderViewer({ itemId: 102 })
    expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeEnabled()
  })

  it('keeps the edge nav hidden until pointer activity, then fades it out (#1561)', () => {
    vi.useFakeTimers()
    try {
      renderViewer()
      const frame = screen.getByTestId('sequence-viewer-frame')
      const overlay = screen.getByTestId('sequence-nav-overlay')
      const next = screen.getByRole('button', { name: 'Next image' })
      expect(overlay).toHaveStyle({ opacity: '0' })
      expect(next).toHaveStyle({ pointerEvents: 'none' })

      fireEvent.pointerEnter(frame)
      expect(overlay).toHaveStyle({ opacity: '1' })
      expect(next).toHaveStyle({ pointerEvents: 'auto' })

      // Pointer activity keeps the nav alive…
      act(() => vi.advanceTimersByTime(1500))
      fireEvent.pointerMove(frame)
      act(() => vi.advanceTimersByTime(1500))
      expect(overlay).toHaveStyle({ opacity: '1' })
      // …then it fades back out once the pointer has been idle.
      act(() => vi.advanceTimersByTime(2000))
      expect(overlay).toHaveStyle({ opacity: '0' })
      expect(next).toHaveStyle({ pointerEvents: 'none' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the edge nav immediately when the pointer leaves the frame', () => {
    renderViewer()
    const frame = screen.getByTestId('sequence-viewer-frame')
    const overlay = screen.getByTestId('sequence-nav-overlay')
    fireEvent.pointerEnter(frame)
    expect(overlay).toHaveStyle({ opacity: '1' })
    fireEvent.pointerLeave(frame)
    expect(overlay).toHaveStyle({ opacity: '0' })
  })

  it('reveals the edge nav when a button receives keyboard focus', () => {
    renderViewer()
    const overlay = screen.getByTestId('sequence-nav-overlay')
    const next = screen.getByRole('button', { name: 'Next image' })
    fireEvent.focus(next)
    expect(overlay).toHaveStyle({ opacity: '1' })
    expect(next).toHaveStyle({ pointerEvents: 'auto' })
  })

  it('keeps the edge nav visible while a button holds focus, fading only after blur (#1561)', () => {
    vi.useFakeTimers()
    try {
      renderViewer()
      const overlay = screen.getByTestId('sequence-nav-overlay')
      const next = screen.getByRole('button', { name: 'Next image' })
      const prev = screen.getByRole('button', { name: 'Previous image' })

      fireEvent.focus(next)
      // Well past the idle delay — the focused button must stay visible and
      // interactive for keyboard users.
      act(() => vi.advanceTimersByTime(5000))
      expect(overlay).toHaveStyle({ opacity: '1' })
      expect(next).toHaveStyle({ pointerEvents: 'auto' })

      // Focus moving to the other edge button keeps the nav open…
      fireEvent.blur(next, { relatedTarget: prev })
      fireEvent.focus(prev)
      act(() => vi.advanceTimersByTime(5000))
      expect(overlay).toHaveStyle({ opacity: '1' })

      // …and only after focus leaves the overlay does the idle fade begin.
      fireEvent.blur(prev, { relatedTarget: null })
      act(() => vi.advanceTimersByTime(2000))
      expect(overlay).toHaveStyle({ opacity: '0' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('navigates with ArrowLeft/ArrowRight from inside the viewer region', () => {
    const { props } = renderViewer({ itemId: 101 })
    const region = screen.getByTestId('sequence-collection-viewer')
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(props.onSelectItem).toHaveBeenCalledWith(102)
    fireEvent.keyDown(region, { key: 'ArrowLeft' })
    expect(props.onSelectItem).toHaveBeenCalledWith(100)
  })

  it('does not treat arrow keys inside editable fields as navigation', () => {
    const { props } = renderViewer({ itemId: 101 })
    const region = screen.getByTestId('sequence-collection-viewer')
    const input = document.createElement('input')
    region.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(props.onSelectItem).not.toHaveBeenCalled()
  })

  it('opens the current image in the regular ?image= view', () => {
    const collection = seqCollection()
    const { props } = renderViewer({ collection, itemId: 101 })
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))
    expect(props.onOpenImage).toHaveBeenCalledWith(collection.images[1])
  })

  it('navigates by clicking a strip thumbnail and marks the current one', () => {
    const { props } = renderViewer({ itemId: 101 })
    fireEvent.click(screen.getByRole('button', { name: 'Go to Slice 3' }))
    expect(props.onSelectItem).toHaveBeenCalledWith(102)
    expect(screen.getByRole('button', { name: 'Go to Slice 2' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('passes read-only props with annotations, overlays and measurement from metadata', () => {
    const meta = {
      canvas_annotations: [{ type: 'rect', id: 'a1' }],
      locked_overlays: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
      measurement_scale: 500,
      measurement_unit: 'mm',
    }
    const collection = seqCollection({ images: [makeImage({ id: 1, metadataExtra: meta })] })
    renderViewer({ collection })
    expect(lastViewerProps).not.toBeNull()
    expect(lastViewerProps!.canEditContent).toBe(false)
    expect(lastViewerProps!.canvasAnnotations).toEqual(meta.canvas_annotations)
    expect(lastViewerProps!.initialOverlays).toEqual(meta.locked_overlays)
    expect(lastViewerProps!.overlaysLocked).toBe(true)
    expect(lastViewerProps!.measurement).toEqual({ scale: 500, unit: 'mm' })
    // No edit callbacks — the viewer cannot persist anything.
    expect(lastViewerProps!.onCanvasAnnotationsChange).toBeUndefined()
    expect(lastViewerProps!.onLockOverlays).toBeUndefined()
    expect(lastViewerProps!.onSaveCanvasAnnotations).toBeUndefined()
  })

  it('forwards tile-source renewals to onImageRenewed', () => {
    const { props } = renderViewer()
    const fresh = { id: 100 } as never
    act(() => {
      ;(lastViewerProps!.onTileSourceRenewed as (i: unknown) => void)(fresh)
    })
    expect(props.onImageRenewed).toHaveBeenCalledWith(fresh)
  })

  it('surfaces a viewer error and skips to the next available image', () => {
    const { props } = renderViewer({ itemId: 100 })
    act(() => {
      ;(lastViewerProps!.onError as (m: string) => void)('tiles expired')
    })
    expect(props.onError).toHaveBeenCalledWith('tiles expired')
    expect(props.onSelectItem).toHaveBeenCalledWith(101)
  })

  it('shows the empty state when the collection has no visible images', () => {
    renderViewer({ collection: seqCollection({ images: [] }) })
    expect(screen.getByTestId('sequence-viewer-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('image-viewer')).not.toBeInTheDocument()
  })

  it('says all images are restricted when members exist but none are visible (#1529)', () => {
    renderViewer({ collection: seqCollection({ images: [], memberCount: 3 }) })
    expect(screen.getByTestId('sequence-viewer-empty')).toHaveTextContent(
      'All images in this collection are currently restricted.',
    )
  })

  it('shows the unavailable state after every image has failed', () => {
    const collection = seqCollection({ images: images(1) })
    renderViewer({ collection })
    act(() => {
      ;(lastViewerProps!.onError as (m: string) => void)('gone')
    })
    expect(screen.getByTestId('sequence-viewer-unavailable')).toBeInTheDocument()
  })

  it('keeps member numbering stable when a member fails', () => {
    const { rerender, props } = renderViewer()
    act(() => {
      ;(lastViewerProps!.onError as (m: string) => void)('gone')
    })
    // Slice 1 failed → skipped to Slice 2; position reads 2 of 3, not 1 of 2.
    expect(props.onSelectItem).toHaveBeenCalledWith(101)
    rerender(<SequenceCollectionViewer {...props} itemId={101} />)
    expect(screen.getByTestId('sequence-position')).toHaveTextContent('2 of 3')
    // The failed thumbnail stays visible but dimmed and disabled.
    expect(screen.getByRole('button', { name: 'Go to Slice 1' })).toBeDisabled()
  })

  it('resets failures and reorder mode when a different collection opens', () => {
    const { props, rerender } = renderViewer({ reordering: true })
    act(() => {
      ;(lastViewerProps!.onError as (m: string) => void)('gone')
    })
    const next = seqCollection({ id: 77, images: [makeImage({ id: 100, name: 'Slice 1' })] })
    rerender(
      <SequenceCollectionViewer {...props} collection={next} itemId={100} reordering={false} />,
    )
    // The controlled reorder mode is exited by the collection-change effect
    // and the shared image id is no longer failed.
    expect(props.onReorderingChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'Go to Slice 1' })).toBeEnabled()
  })

  it('offers reorder mode via the controlled prop and persists a drag reorder', async () => {
    const collection = seqCollection()
    const { props } = renderViewer({ collection, reordering: true })
    expect(capturedOnDragEnd).toBeDefined()
    // Drag the first item onto the third: move() commits source.index.
    capturedOnDragEnd!({
      operation: {
        source: { id: 'seq-100', index: 2, initialIndex: 0, group: 'strip' },
        target: { id: 'seq-102', index: 2, initialIndex: 2, group: 'strip' },
        canceled: false,
      },
    })
    expect(props.onReorder).toHaveBeenCalledWith([101, 102, 100])
  })

  it('reports a reorder failure through onError', async () => {
    const err = new Error('stale version')
    const onReorder = vi.fn().mockRejectedValue(err)
    const { props } = renderViewer({ onReorder, reordering: true })
    capturedOnDragEnd!({
      operation: {
        source: { id: 'seq-100', index: 2, initialIndex: 0, group: 'strip' },
        target: { id: 'seq-102', index: 2, initialIndex: 2, group: 'strip' },
        canceled: false,
      },
    })
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith('Failed to reorder collection images.'),
    )
  })

  it('ignores a canceled drag and a drop that changes nothing', () => {
    const { props } = renderViewer({ reordering: true })
    capturedOnDragEnd!({
      operation: {
        source: { id: 'seq-100', index: 0, initialIndex: 0, group: 'strip' },
        target: null,
        canceled: true,
      },
    })
    // Dropping the item back onto itself leaves the order unchanged.
    capturedOnDragEnd!({
      operation: {
        source: { id: 'seq-100', index: 0, initialIndex: 0, group: 'strip' },
        target: { id: 'seq-100', index: 0, initialIndex: 0, group: 'strip' },
        canceled: false,
      },
    })
    expect(props.onReorder).not.toHaveBeenCalled()
  })
})
