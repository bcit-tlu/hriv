/**
 * Tests for useDraggablePosition — the free-drag positioning hook used by the
 * canvas annotation toolbar (and future movable viewer chrome).
 *
 * jsdom has no layout engine, so element geometry (clientWidth/Height,
 * offsetWidth/Height, getBoundingClientRect) is stubbed per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useDraggablePosition, clearDraggablePositionCache } from '../src/useDraggablePosition'

function Harness({ cacheKey, onDragStart }: { cacheKey?: string; onDragStart?: () => void }) {
  const { targetRef, position, dragging, handleProps } = useDraggablePosition({
    cacheKey,
    onDragStart,
  })
  return (
    <div data-testid="parent" style={{ position: 'relative' }}>
      <div
        ref={targetRef}
        data-testid="target"
        style={
          position
            ? { position: 'absolute', left: position.x, top: position.y, transform: 'none' }
            : { position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }
        }
      >
        <button type="button" data-testid="handle" {...handleProps}>
          drag
        </button>
        <span data-testid="drag-state">{dragging ? 'dragging' : 'idle'}</span>
      </div>
    </div>
  )
}

/** Give the harness a measurable layout: 500x400 parent, 100x40 target. */
function stubLayout({
  parentW = 500,
  parentH = 400,
  targetW = 100,
  targetH = 40,
  targetLeft = 200,
  targetTop = 0,
} = {}) {
  const parent = screen.getByTestId('parent')
  const target = screen.getByTestId('target')
  Object.defineProperty(parent, 'clientWidth', { value: parentW, configurable: true })
  Object.defineProperty(parent, 'clientHeight', { value: parentH, configurable: true })
  Object.defineProperty(target, 'offsetWidth', { value: targetW, configurable: true })
  Object.defineProperty(target, 'offsetHeight', { value: targetH, configurable: true })
  parent.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0 }) as DOMRect)
  target.getBoundingClientRect = vi.fn(() => ({ left: targetLeft, top: targetTop }) as DOMRect)
  return { parent, target }
}

describe('useDraggablePosition', () => {
  beforeEach(() => {
    clearDraggablePositionCache()
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports null position until dragged (caller renders default layout)', () => {
    render(<Harness />)
    const target = screen.getByTestId('target')
    expect(target.style.left).toBe('50%')
    expect(target.style.transform).toBe('translateX(-50%)')
  })

  it('moves the target by the pointer delta from its measured position', () => {
    render(<Harness />)
    const { target } = stubLayout({ targetLeft: 200, targetTop: 30 })
    const handle = screen.getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10, clientY: 10 })
    expect(screen.getByTestId('drag-state').textContent).toBe('dragging')
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 60, clientY: 70 })
    expect(target.style.left).toBe('250px')
    expect(target.style.top).toBe('90px')
    expect(target.style.transform).toBe('none')
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(screen.getByTestId('drag-state').textContent).toBe('idle')
  })

  it('takes and releases pointer capture on the handle', () => {
    render(<Harness />)
    stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 0, clientY: 0 })
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
    fireEvent.pointerUp(handle, { pointerId: 7 })
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it('clamps the element inside the parent bounds', () => {
    render(<Harness />)
    const { target } = stubLayout()
    const handle = screen.getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    // Way past the right/bottom edges: max = 500-100 / 400-40
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 9999, clientY: 9999 })
    expect(target.style.left).toBe('400px')
    expect(target.style.top).toBe('360px')

    // Past the top/left edges clamps to 0
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -9999, clientY: -9999 })
    expect(target.style.left).toBe('0px')
    expect(target.style.top).toBe('0px')
    fireEvent.pointerUp(handle, { pointerId: 1 })
  })

  it('ignores non-primary pointer buttons', () => {
    render(<Harness />)
    const { target } = stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 50 })
    expect(target.style.left).toBe('50%')
  })

  it('nudges with arrow keys and resets with Home', () => {
    render(<Harness />)
    const { target } = stubLayout({ targetLeft: 200, targetTop: 30 })
    const handle = screen.getByTestId('handle')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(target.style.left).toBe('208px')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(target.style.top).toBe('22px')
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(target.style.top).toBe('54px')

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(target.style.left).toBe('50%')
  })

  it('resets to the default position on double-click', () => {
    render(<Harness />)
    const { target } = stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(target.style.left).toBe('208px')
    fireEvent.doubleClick(handle)
    expect(target.style.left).toBe('50%')
  })

  it('restores a cached position after unmount/remount', () => {
    const utils = render(<Harness cacheKey="test-toolbar" />)
    stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(screen.getByTestId('target').style.left).toBe('208px')

    utils.unmount()
    render(<Harness cacheKey="test-toolbar" />)
    expect(screen.getByTestId('target').style.left).toBe('208px')
  })

  it('re-clamps the stored position when the window resizes', () => {
    render(<Harness cacheKey="test-toolbar" />)
    const { target } = stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(target.style.left).toBe('208px')

    // Shrink the parent so the stored position is out of bounds
    Object.defineProperty(screen.getByTestId('parent'), 'clientWidth', {
      value: 250,
      configurable: true,
    })
    fireEvent(window, new Event('resize'))
    expect(target.style.left).toBe('150px')
  })

  it('invokes onDragStart when a pointer drag begins', () => {
    const onDragStart = vi.fn()
    render(<Harness onDragStart={onDragStart} />)
    stubLayout()
    const handle = screen.getByTestId('handle')
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    expect(onDragStart).toHaveBeenCalledOnce()
    fireEvent.pointerUp(handle, { pointerId: 1 })
  })
})
