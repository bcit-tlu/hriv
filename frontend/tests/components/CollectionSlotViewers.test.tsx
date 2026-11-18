import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SlotViewport } from '../../src/types'
import { makeCollection, makeImage } from '../helpers/fixtures'
import SequenceCollectionViewer from '../../src/components/SequenceCollectionViewer'
import SynchronizedCollectionViewer from '../../src/components/SynchronizedCollectionViewer'

function fakeViewer(initial?: SlotViewport) {
  const state = { x: 0.5, y: 0.5, zoom: 1, rotation: 0, ...initial }
  const handlers = new Map<string, Set<() => void>>()
  const fire = (name: string) => handlers.get(name)?.forEach((callback) => callback())
  return {
    state,
    viewport: {
      getCenter: () => ({ x: state.x, y: state.y }),
      getZoom: () => state.zoom,
      getRotation: () => state.rotation,
      zoomTo: (zoom: number) => {
        state.zoom = zoom
        fire('viewport-change')
      },
      panTo: (point: { x: number; y: number }) => {
        Object.assign(state, point)
        fire('viewport-change')
      },
      setRotation: (rotation: number) => {
        state.rotation = rotation
        fire('viewport-change')
      },
      goHome: vi.fn(),
    },
    addHandler: (name: string, callback: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set())
      handlers.get(name)?.add(callback)
    },
    addOnceHandler: vi.fn(),
    removeHandler: (name: string, callback: () => void) => handlers.get(name)?.delete(callback),
  }
}

const viewers = new Map<number, ReturnType<typeof fakeViewer>>()
vi.mock('../../src/components/ImageViewer', () => ({
  default: function Viewer(props: {
    imageId: number
    initialViewport?: SlotViewport
    onViewerReady?: (viewer: ReturnType<typeof fakeViewer> | null) => void
  }) {
    const [instance] = useState(() => fakeViewer(props.initialViewport))
    const [ready] = useState(() => props.onViewerReady)
    const [key] = useState(() => props.initialViewport?.x ?? 0)
    useEffect(() => {
      viewers.set(key, instance)
      ready?.(instance)
      return () => {
        viewers.delete(key)
        ready?.(null)
      }
    }, [instance, ready, key])
    return (
      <div
        data-testid="slot-viewer"
        data-image-id={props.imageId}
        data-x={props.initialViewport?.x}
      />
    )
  },
}))

const members = [0.2, 0.8].map((x, index) => ({
  ...makeImage({ id: 100, name: 'One slide' }),
  slot: {
    id: 11 + index,
    viewport_state: { x, y: 0.4, zoom: 2, rotation: index * 30 },
    thumb: `/crop-${index}.jpg`,
    label: `Study ${index + 1}`,
  },
}))
const actions = { onOpenImage: vi.fn(), onImageRenewed: vi.fn(), onError: vi.fn() }
beforeEach(() => {
  viewers.clear()
  vi.clearAllMocks()
})

it('steps between same-image coordinates by slot and remounts at the seeded view', () => {
  const collection = makeCollection({ type: 'sequence', images: members })
  const selected = vi.fn()
  const props = {
    ...actions,
    collection,
    markersEnabled: true,
    itemId: 100,
    onSelectItem: selected,
  }
  const { rerender } = render(<SequenceCollectionViewer {...props} slotId={11} />)
  expect(screen.getByTestId('sequence-thumbnail-strip').textContent).toBe('')
  expect(screen.getByRole('heading', { name: 'Study 1' })).toBeVisible()
  expect(screen.getByTestId('slot-viewer')).toHaveAttribute('data-x', '0.2')
  expect(
    screen.getByRole('button', { name: 'Go to Study 1' }).querySelector('img'),
  ).toHaveAttribute('src', '/crop-0.jpg')
  fireEvent.click(screen.getByRole('button', { name: 'Go to Study 2' }))
  expect(selected).toHaveBeenCalledWith(100, 12)
  rerender(<SequenceCollectionViewer {...props} slotId={12} />)
  expect(screen.getByTestId('slot-viewer')).toHaveAttribute('data-image-id', '100')
  expect(screen.getByTestId('slot-viewer')).toHaveAttribute('data-x', '0.8')
  expect(viewers.has(0.2)).toBe(false)
  expect(viewers.get(0.8)?.state.rotation).toBe(30)
  expect(screen.getByTestId('sequence-thumbnail-strip').textContent).toBe('')
  expect(screen.getByRole('heading', { name: 'Study 2' })).toBeVisible()
})

it.each([null, ''])(
  'uses the image name when the slot label is %j without a visible thumbnail caption',
  (label) => {
    render(
      <SequenceCollectionViewer
        {...actions}
        collection={makeCollection({
          type: 'sequence',
          images: [{ ...members[0], slot: { ...members[0].slot, label } }],
        })}
        markersEnabled
        itemId={100}
        slotId={11}
        onSelectItem={vi.fn()}
      />,
    )
    expect(screen.getByTestId('sequence-thumbnail-strip').textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Go to One slide' })).toBeEnabled()
    expect(screen.getByRole('img', { name: 'One slide' })).toHaveAttribute('src', '/crop-0.jpg')
  },
)

it('falls back to the real image parameter for an unavailable slot', () => {
  render(
    <SequenceCollectionViewer
      {...actions}
      collection={makeCollection({ images: members })}
      markersEnabled
      itemId={100}
      slotId={999}
      onSelectItem={vi.fn()}
    />,
  )
  expect(screen.getByTestId('slot-viewer')).toHaveAttribute('data-x', '0.2')
})

it('compares one slide in two independent panes and saves slot viewports only', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(
    <SynchronizedCollectionViewer
      {...actions}
      collection={makeCollection({ type: 'synchronized', images: members })}
      markersEnabled
      onSaveViewport={save}
    />,
  )
  expect(screen.getAllByTestId('slot-viewer')).toHaveLength(2)
  expect(viewers.size).toBe(2)
  fireEvent.click(screen.getByTestId('pin-toggle-12'))
  act(() => viewers.get(0.2)?.viewport.panTo({ x: 0.35, y: 0.45 }))
  fireEvent.click(screen.getByRole('button', { name: /Save view|Set as default/i }))
  expect(save).toHaveBeenCalledWith(
    {},
    {
      '11': { x: 0.35, y: 0.45, zoom: 2, rotation: 0 },
      '12': { x: 0.8, y: 0.4, zoom: 2, rotation: 30 },
    },
  )
})
