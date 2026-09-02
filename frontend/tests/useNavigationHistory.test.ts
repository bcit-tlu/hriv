/**
 * Unit tests for useNavigationHistory hook and helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNavigationHistory, buildNavHistoryState } from '../src/useNavigationHistory'
import type { NavHistoryState } from '../src/useNavigationHistory'

describe('buildNavHistoryState', () => {
  it('returns an object with _hriv marker', () => {
    const state = buildNavHistoryState('browse', [], null)
    expect(state._hriv).toBe(true)
  })

  it('stores page, catIds, and imageId', () => {
    const state = buildNavHistoryState('manage', [1, 2, 3], 42)
    expect(state.page).toBe('manage')
    expect(state.catIds).toEqual([1, 2, 3])
    expect(state.imageId).toBe(42)
  })
})

describe('useNavigationHistory', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>
  let addEventSpy: ReturnType<typeof vi.spyOn>
  let removeEventSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    pushStateSpy = vi.spyOn(window.history, 'pushState')
    addEventSpy = vi.spyOn(window, 'addEventListener')
    removeEventSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    pushStateSpy.mockRestore()
    addEventSpy.mockRestore()
    removeEventSpy.mockRestore()
  })

  it('registers a popstate listener on mount', () => {
    const onPopState = vi.fn()
    renderHook(() => useNavigationHistory(onPopState))
    expect(addEventSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
  })

  it('removes the popstate listener on unmount', () => {
    const onPopState = vi.fn()
    const { unmount } = renderHook(() => useNavigationHistory(onPopState))
    unmount()
    expect(removeEventSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
  })

  it('does not register listeners or mutate history when synchronization is disabled', () => {
    const onPopState = vi.fn()
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { result } = renderHook(() => useNavigationHistory(onPopState, false))

    expect(addEventSpy).not.toHaveBeenCalledWith('popstate', expect.any(Function))
    act(() => {
      result.current.pushNavState('manage')
      result.current.replayPopState(2)
      window.dispatchEvent(
        new PopStateEvent('popstate', {
          state: buildNavHistoryState('manage', [], null, 2),
        }),
      )
    })

    expect(pushStateSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(backSpy).not.toHaveBeenCalled()
    expect(onPopState).not.toHaveBeenCalled()
    goSpy.mockRestore()
    backSpy.mockRestore()
  })

  describe('pushNavState', () => {
    it('calls history.pushState with a NavHistoryState object', () => {
      const onPopState = vi.fn()
      const { result } = renderHook(() => useNavigationHistory(onPopState))

      act(() => {
        result.current.pushNavState('browse', [5, 12], 456)
      })

      expect(pushStateSpy).toHaveBeenCalledTimes(1)
      const [state, , url] = pushStateSpy.mock.calls[0]
      const nav = state as NavHistoryState
      expect(nav._hriv).toBe(true)
      expect(nav.page).toBe('browse')
      expect(nav.catIds).toEqual([5, 12])
      expect(nav.imageId).toBe(456)
      expect(url).toContain('cat=5%2C12')
      expect(url).toContain('image=456')
    })

    it('omits page param for browse (default)', () => {
      const onPopState = vi.fn()
      const { result } = renderHook(() => useNavigationHistory(onPopState))

      act(() => {
        result.current.pushNavState('browse', [], null)
      })

      const [, , url] = pushStateSpy.mock.calls[0]
      expect(url).not.toContain('page=')
    })

    it('includes page param for non-browse pages', () => {
      const onPopState = vi.fn()
      const { result } = renderHook(() => useNavigationHistory(onPopState))

      act(() => {
        result.current.pushNavState('manage', [], null)
      })

      const [, , url] = pushStateSpy.mock.calls[0]
      expect(url).toContain('page=manage')
    })

    it('builds a clean pathname when browse with no cat/image', () => {
      const onPopState = vi.fn()
      const { result } = renderHook(() => useNavigationHistory(onPopState))

      act(() => {
        result.current.pushNavState('browse', [], null)
      })

      const [, , url] = pushStateSpy.mock.calls[0]
      // Should be just the pathname with no query string
      expect(url).toBe(window.location.pathname)
    })
  })

  describe('popstate handling', () => {
    it('restores the displayed entry when a guarded Back traversal is rejected', () => {
      window.history.replaceState(buildNavHistoryState('browse', [], null, 3), '', '/')
      const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      const onPopState = vi.fn(() => false)
      renderHook(() => useNavigationHistory(onPopState))
      const previous = buildNavHistoryState('browse', [], null, 3)
      const target = buildNavHistoryState('browse', [1], null, 2)

      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: target })))

      expect(onPopState).toHaveBeenCalledWith('browse', [1], null, {
        fromIndex: 3,
        toIndex: 2,
      })
      expect(goSpy).toHaveBeenCalledWith(1)

      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: previous })))
      expect(onPopState).toHaveBeenCalledOnce()
      goSpy.mockRestore()
    })

    it('replays an accepted guarded traversal after a discard confirmation', () => {
      window.history.replaceState(buildNavHistoryState('browse', [], null, 3), '', '/')
      const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      const onPopState = vi.fn(() => false)
      const { result } = renderHook(() => useNavigationHistory(onPopState))
      const target = buildNavHistoryState('manage', [], null, 4)

      act(() => result.current.replayPopState(4))
      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: target })))

      expect(goSpy).toHaveBeenCalledWith(1)
      expect(onPopState).toHaveBeenCalledWith('manage', [], null, {
        fromIndex: 3,
        toIndex: 4,
      })
      goSpy.mockRestore()
    })

    it.each(['Back', 'Forward'])(
      'guards and replays a legacy app-owned %s entry without probing direction',
      () => {
        const current = buildNavHistoryState('browse', [], 7, 3)
        window.history.replaceState(current, '', '/?image=7')
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
        const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
        const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
        const onPopState = vi.fn(() => false)
        const { result } = renderHook(() => useNavigationHistory(onPopState))
        const legacy = { _hriv: true, page: 'browse', catIds: [1], imageId: null }
        window.history.replaceState(legacy, '', '/?cat=1')

        act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: legacy })))
        expect(onPopState).toHaveBeenCalledWith('browse', [1], null, { fromIndex: 3 })
        expect(goSpy).not.toHaveBeenCalled()
        expect(pushStateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            ...current,
            historyIndex: 1,
            historyKey: expect.any(String),
          }),
          '',
          '/?image=7',
        )

        act(() => result.current.replayPopState())
        expect(goSpy).not.toHaveBeenCalled()
        expect(backSpy).toHaveBeenCalledOnce()
        window.history.replaceState(legacy, '', '/?cat=1')
        act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: legacy })))
        expect(replaceStateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            ...legacy,
            historyIndex: 0,
            historyKey: expect.any(String),
          }),
          '',
          '/?cat=1',
        )
        expect(onPopState).toHaveBeenCalledTimes(2)

        const migratedState = replaceStateSpy.mock.lastCall?.[0] as NavHistoryState
        window.history.replaceState(migratedState, '', '/?cat=1')
        expect(buildNavHistoryState('browse', [1], null)).toEqual({
          ...migratedState,
          page: 'browse',
          catIds: [1],
          imageId: null,
        })

        act(() => result.current.pushNavState('browse', [2], null))
        expect(pushStateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            historyIndex: 1,
            historyKey: migratedState.historyKey,
          }),
          '',
          '/?cat=2',
        )

        replaceStateSpy.mockRestore()
        goSpy.mockRestore()
        backSpy.mockRestore()
      },
    )

    it('keeps the legacy destination available after Keep Editing and another traversal', () => {
      const current = buildNavHistoryState('browse', [], 7, 3)
      window.history.replaceState(current, '', '/?image=7')
      const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const onPopState = vi.fn(() => false)
      renderHook(() => useNavigationHistory(onPopState))
      const legacy = { _hriv: true, page: 'manage', catIds: [], imageId: null }

      window.history.replaceState(legacy, '', '/?page=manage')
      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: legacy })))
      const firstRestoredState = pushStateSpy.mock.lastCall?.[0] as NavHistoryState

      window.history.replaceState(legacy, '', '/?page=manage')
      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: legacy })))
      const secondRestoredState = pushStateSpy.mock.lastCall?.[0] as NavHistoryState

      expect(onPopState).toHaveBeenCalledTimes(2)
      expect(goSpy).not.toHaveBeenCalled()
      expect(backSpy).not.toHaveBeenCalled()
      expect(secondRestoredState).toEqual(
        expect.objectContaining({
          page: current.page,
          imageId: current.imageId,
          historyIndex: 1,
        }),
      )
      expect(secondRestoredState.historyKey).not.toBe(firstRestoredState.historyKey)
      goSpy.mockRestore()
      backSpy.mockRestore()
    })

    it('does not traverse beyond a rejected legacy entry toward a cross-document successor', () => {
      const current = buildNavHistoryState('browse', [], 7, 3)
      window.history.replaceState(current, '', '/?image=7')
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
      const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const onPopState = vi.fn(() => false)
      const legacy = { _hriv: true, page: 'manage', catIds: [], imageId: null }
      renderHook(() => useNavigationHistory(onPopState))
      window.history.replaceState(legacy, '', '/?page=manage')

      act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: legacy })))

      expect(goSpy).not.toHaveBeenCalled()
      expect(backSpy).not.toHaveBeenCalled()
      expect(pushStateSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ...current,
          historyIndex: 1,
          historyKey: expect.any(String),
        }),
        '',
        '/?image=7',
      )
      replaceStateSpy.mockRestore()
      goSpy.mockRestore()
      backSpy.mockRestore()
    })

    it('calls onPopState with decoded state on popstate event', () => {
      window.history.replaceState(buildNavHistoryState('browse', [], null, 3), '', '/')
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      // Simulate a popstate event with our state
      const navState = buildNavHistoryState('manage', [1, 2], 99, 4)
      const event = new PopStateEvent('popstate', {
        state: navState,
      })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('manage', [1, 2], 99, {
        fromIndex: 3,
        toIndex: 4,
      })
    })

    it('defaults to browse root when popstate has no recognized state', () => {
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      const event = new PopStateEvent('popstate', { state: null })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('browse', [], null)
    })

    it('defaults to browse root for foreign state objects', () => {
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      const event = new PopStateEvent('popstate', {
        state: { someOtherApp: true },
      })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('browse', [], null)
    })

    it('defaults to browse root when state has _hriv but missing page', () => {
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      const event = new PopStateEvent('popstate', {
        state: { _hriv: true },
      })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('browse', [], null)
    })

    it('defaults to browse root when catIds is not an array', () => {
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      const event = new PopStateEvent('popstate', {
        state: { _hriv: true, page: 'browse', catIds: 'not-array', imageId: null },
      })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('browse', [], null)
    })

    it('defaults to browse root when imageId is a string', () => {
      const onPopState = vi.fn()
      renderHook(() => useNavigationHistory(onPopState))

      const event = new PopStateEvent('popstate', {
        state: { _hriv: true, page: 'browse', catIds: [], imageId: 'bad' },
      })
      window.dispatchEvent(event)

      expect(onPopState).toHaveBeenCalledWith('browse', [], null)
    })

    it('uses the latest callback reference', () => {
      window.history.replaceState(buildNavHistoryState('browse', [], null, 3), '', '/')
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = renderHook(({ cb }) => useNavigationHistory(cb), {
        initialProps: { cb: first },
      })

      rerender({ cb: second })

      const event = new PopStateEvent('popstate', {
        state: buildNavHistoryState('admin', [], null, 4),
      })
      window.dispatchEvent(event)

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith('admin', [], null, {
        fromIndex: 3,
        toIndex: 4,
      })
    })
  })
})
