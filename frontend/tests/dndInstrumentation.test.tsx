import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type {
  CollisionEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/react'

import { DndMonitor, isDndTraceEnabled, logDrag } from '../src/dndInstrumentation'

vi.mock('@dnd-kit/react', () => ({
  useDragDropMonitor: vi.fn(),
}))

import { useDragDropMonitor } from '@dnd-kit/react'

describe('dndInstrumentation', () => {
  let capturedHandlers: Record<string, (event: unknown) => void> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    capturedHandlers = null
    ;(useDragDropMonitor as ReturnType<typeof vi.fn>).mockImplementation(
      (handlers: Record<string, (event: unknown) => void>) => {
        capturedHandlers = handlers
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isDndTraceEnabled', () => {
    it('is true in dev mode', () => {
      expect(isDndTraceEnabled(true)).toBe(true)
    })

    it('is false in production without localStorage flag', () => {
      expect(isDndTraceEnabled(false)).toBe(false)
    })

    it('is true in production when localStorage flag is set', () => {
      localStorage.setItem('hriv-dnd-trace', '1')
      expect(isDndTraceEnabled(false)).toBe(true)
    })

    it('ignores non-"1" localStorage values', () => {
      localStorage.setItem('hriv-dnd-trace', 'true')
      expect(isDndTraceEnabled(false)).toBe(false)
    })
  })

  describe('logDrag', () => {
    it('logs the label and payload when tracing is enabled', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      vi.spyOn(performance, 'now').mockReturnValue(123.456)
      logDrag('test', { a: 1 })
      expect(spy).toHaveBeenCalledWith('[dnd 123.5] test', { a: 1 })
      spy.mockRestore()
    })

    it('logs an empty object payload when none is provided', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      vi.spyOn(performance, 'now').mockReturnValue(0)
      logDrag('test')
      expect(spy).toHaveBeenCalledWith('[dnd 0.0] test', {})
      spy.mockRestore()
    })
  })

  describe('DndMonitor', () => {
    it('registers drag event handlers', () => {
      render(<DndMonitor />)
      expect(useDragDropMonitor).toHaveBeenCalled()
      expect(capturedHandlers).not.toBeNull()
      expect(typeof capturedHandlers?.onDragStart).toBe('function')
      expect(typeof capturedHandlers?.onDragMove).toBe('function')
      expect(typeof capturedHandlers?.onDragOver).toBe('function')
      expect(typeof capturedHandlers?.onCollision).toBe('function')
      expect(typeof capturedHandlers?.onDragEnd).toBe('function')
    })

    it('renders nothing', () => {
      const { container } = render(<DndMonitor />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('monitor throttling', () => {
    let now = 150
    let spy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      now = 150
      spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      render(<DndMonitor />)
    })

    afterEach(() => {
      spy.mockRestore()
    })

    function makeDragMoveEvent(): DragMoveEvent {
      return {
        operation: {
          source: { id: 'src' },
          position: { current: { x: 10, y: 20 }, delta: { x: 5, y: 0 } },
        },
        by: { x: 1, y: 0 },
      } as unknown as DragMoveEvent
    }

    it('logs dragstart and dragend immediately', () => {
      const start = {
        operation: { source: { id: 'src' }, position: { current: { x: 0, y: 0 } } },
      } as unknown as DragStartEvent
      capturedHandlers?.onDragStart(start)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('dragstart'), expect.any(Object))

      const end = {
        canceled: false,
        operation: {
          source: { id: 'src' },
          target: { id: 'tgt' },
          position: { current: { x: 0, y: 0 } },
        },
      } as unknown as DragEndEvent
      capturedHandlers?.onDragEnd(end)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('dragend'), expect.any(Object))
    })

    it('throttles dragmove to one log per 150ms window', () => {
      const move = makeDragMoveEvent()
      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(1)

      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(1)

      now = 301
      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('throttles collision to one log per 150ms window', () => {
      const collision = {
        collisions: [{ id: 'a', priority: 1, value: 0.5 }],
      } as unknown as CollisionEvent
      capturedHandlers?.onCollision(collision)
      expect(spy).toHaveBeenCalledTimes(1)

      capturedHandlers?.onCollision(collision)
      expect(spy).toHaveBeenCalledTimes(1)

      now = 301
      capturedHandlers?.onCollision(collision)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('resets move and collision throttle windows on dragstart', () => {
      const start: DragStartEvent = {
        operation: { source: { id: 'src' }, position: { current: { x: 0, y: 0 } } },
      } as unknown as DragStartEvent
      const move = makeDragMoveEvent()

      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(1)

      // Without reset, this would be throttled at the same timestamp.
      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(1)

      capturedHandlers?.onDragStart(start)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('dragstart'), expect.any(Object))

      // After a dragstart, the move window is reset and should log again.
      capturedHandlers?.onDragMove(move)
      expect(spy).toHaveBeenCalledTimes(3)
    })

    it('logs every dragover event without throttling', () => {
      const over = {
        operation: {
          source: { id: 'src' },
          target: { id: 'tgt' },
          position: { current: { x: 1, y: 1 } },
        },
      } as unknown as DragOverEvent
      capturedHandlers?.onDragOver(over)
      capturedHandlers?.onDragOver(over)
      expect(spy).toHaveBeenCalledTimes(2)
    })
  })
})
