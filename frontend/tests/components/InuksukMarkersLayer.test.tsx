import { act, fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type OpenSeadragon from 'openseadragon'
import InuksukMarkersLayer from '../../src/components/InuksukMarkersLayer'
import { INUKSUK_FIXTURE } from '../../src/components/inuksukFixtures'

function fakeViewer() {
  const container = document.createElement('div')
  const handlers = new Map<string, () => void>()
  const viewport = {
    getFlip: vi.fn(() => false),
    pixelFromPoint: vi.fn(() => ({ x: 120, y: 90 })),
    setRotation: vi.fn(),
    panTo: vi.fn(),
    zoomTo: vi.fn(),
  }
  const instance = {
    canvas: container,
    container,
    viewport,
    addHandler: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
    removeHandler: vi.fn(),
  }
  return { instance: instance as unknown as OpenSeadragon.Viewer, viewport, container, handlers }
}
describe('InuksukMarkersLayer', () => {
  it('mirrors marker and title anchors on flip, resize, and back without mirroring their contents', () => {
    const v = fakeViewer()
    Object.defineProperty(v.container, 'clientWidth', { value: 1000, configurable: true })
    render(<InuksukMarkersLayer viewer={v.instance} items={[INUKSUK_FIXTURE]} />)
    const button = within(v.container).getByRole('button')
    const anchor = button.parentElement!
    const label = within(v.container).getByText('Rose window')
    expect(label.parentElement).toBe(anchor)
    expect(anchor.style.left).toBe('120px')
    v.viewport.getFlip.mockReturnValue(true)
    act(() => v.handlers.get('flip')?.())
    expect(anchor.style.left).toBe('880px')
    Object.defineProperty(v.container, 'clientWidth', { value: 1200 })
    act(() => v.handlers.get('resize')?.())
    expect(anchor.style.left).toBe('1080px')
    expect(anchor.style.top).toBe('90px')
    expect(anchor.style.transform).toBe('')
    expect(button.style.width).toBe('27px')
    v.viewport.getFlip.mockReturnValue(false)
    act(() => v.handlers.get('flip')?.())
    expect(anchor.style.left).toBe('120px')
  })
  it('portals constant CSS-pixel upright markers and labels, reprojects each viewport event, and cleans up', () => {
    const v = fakeViewer()
    const { unmount } = render(
      <InuksukMarkersLayer viewer={v.instance} items={[INUKSUK_FIXTURE]} />,
    )
    const button = within(v.container).getByRole('button')
    const anchor = button.parentElement!
    const label = within(v.container).getByText('Rose window')
    expect(anchor).toHaveStyle({ left: '120px', top: '90px', width: '0px' })
    expect(button).toHaveStyle({ width: '27px', height: '27px' })
    expect(label.style.font).toContain('13px')
    expect(anchor.style.transform).toBe('')
    v.viewport.pixelFromPoint.mockReturnValue({ x: 300, y: 210 })
    for (const name of ['animation', 'animation-finish', 'open', 'resize', 'rotate', 'flip']) {
      const position = v.handlers.get(name)
      expect(position).toBeTypeOf('function')
      act(() => {
        position?.()
      })
      expect(v.viewport.pixelFromPoint).toHaveReturnedWith({ x: 300, y: 210 })
      expect(anchor.style.left).toBe('300px')
      expect(anchor.style.top).toBe('210px')
      expect(button).toHaveStyle({ width: '27px', height: '27px' })
    }
    expect(v.viewport.pixelFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.46, y: 0.29 }),
      true,
    )
    unmount()
    expect(v.instance.removeHandler).toHaveBeenCalledTimes(6)
    expect(v.container).toBeEmptyDOMElement()
  })
  it('smoothly restores the entire viewport, reports selection and highlights it', () => {
    const v = fakeViewer()
    const select = vi.fn()
    render(
      <InuksukMarkersLayer
        viewer={v.instance}
        items={[INUKSUK_FIXTURE]}
        selectedId={7}
        onSelect={select}
      />,
    )
    const marker = within(v.container).getByRole('button', { name: 'View Inuksuk: Rose window' })
    fireEvent.click(marker)
    expect(v.viewport.panTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.46, y: 0.29 }),
      false,
    )
    expect(v.viewport.zoomTo).toHaveBeenCalledWith(2.5, undefined, false)
    expect(v.viewport.setRotation).toHaveBeenCalledWith(0, false)
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    expect(select).toHaveBeenCalledWith(INUKSUK_FIXTURE)
  })
  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])('independently controls marker=%s and label=%s', (markerVisible, labelVisible) => {
    const v = fakeViewer()
    render(
      <InuksukMarkersLayer
        viewer={v.instance}
        items={[{ ...INUKSUK_FIXTURE, markerVisible, labelVisible }]}
      />,
    )
    expect(!!within(v.container).queryByRole('button')).toBe(markerVisible)
    expect(!!within(v.container).queryByText('Rose window')).toBe(labelVisible)
  })
  it('renders an empty layer for no Inuksuks', () => {
    const v = fakeViewer()
    render(<InuksukMarkersLayer viewer={v.instance} items={[]} />)
    expect(within(v.container).queryByRole('button')).toBeNull()
  })
})
