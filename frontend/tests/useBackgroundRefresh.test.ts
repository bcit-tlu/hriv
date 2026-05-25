import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBackgroundRefresh } from '../src/useBackgroundRefresh'

describe('useBackgroundRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: tab is visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not poll when disabled', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useBackgroundRefresh(refresh, false))

    vi.advanceTimersByTime(60_000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('polls at 30-second intervals when enabled', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useBackgroundRefresh(refresh, true))

    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0][0]).toBeInstanceOf(AbortSignal)

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('stops polling when unmounted', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useBackgroundRefresh(refresh, true))

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('pauses when tab becomes hidden and resumes on visible', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useBackgroundRefresh(refresh, true))

    // Simulate tab hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(60_000)
    expect(refresh).not.toHaveBeenCalled()

    // Simulate tab visible again — triggers immediate refresh
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(refresh).toHaveBeenCalledTimes(1) // immediate refresh

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(2) // interval resumed
  })

  it('does not start polling if tab is hidden at mount', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useBackgroundRefresh(refresh, true))

    vi.advanceTimersByTime(60_000)
    expect(refresh).not.toHaveBeenCalled()

    // Tab becomes visible — starts polling
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(refresh).toHaveBeenCalledTimes(1) // immediate refresh
    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(2) // interval running
  })

  it('stops polling when enabled changes to false', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ enabled }) => useBackgroundRefresh(refresh, enabled),
      { initialProps: { enabled: true } },
    )

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })
    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('swallows errors from the refresh callback', () => {
    const refresh = vi.fn().mockRejectedValue(new Error('network'))
    renderHook(() => useBackgroundRefresh(refresh, true))

    // Should not throw
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('invalidate aborts in-flight request and resets timer', () => {
    const refresh = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useBackgroundRefresh(refresh, true))

    // Trigger one poll
    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    const signal = refresh.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(false)

    // Call invalidate
    act(() => { result.current() })
    expect(signal.aborted).toBe(true)

    // Timer restarted — next poll fires after fresh 30s
    vi.advanceTimersByTime(29_999)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('abort signal is passed to each refresh invocation', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useBackgroundRefresh(refresh, true))

    vi.advanceTimersByTime(30_000)
    vi.advanceTimersByTime(30_000)

    // Each call gets its own AbortSignal
    const signal1 = refresh.mock.calls[0][0] as AbortSignal
    const signal2 = refresh.mock.calls[1][0] as AbortSignal
    expect(signal1).not.toBe(signal2)
  })
})
