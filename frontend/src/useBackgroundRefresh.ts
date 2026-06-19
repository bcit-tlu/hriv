import { useCallback, useEffect, useRef } from 'react'

/**
 * Interval (ms) between background refreshes when the tab is visible.
 * 30 seconds balances freshness with server load — the backend returns
 * 304 Not Modified when nothing has changed thanks to ETag caching.
 */
const REFRESH_INTERVAL_MS = 30_000

/**
 * Periodically calls the provided refresh callback in the background.
 * Pauses when the browser tab is hidden and resumes (with an immediate
 * refresh) when the tab regains visibility.
 *
 * Returns an `invalidate` function that aborts any in-flight background
 * request and resets the polling timer.  Call this before foreground
 * mutations to prevent stale background responses from overwriting
 * fresher foreground data.
 *
 * @param refresh — async function that re-fetches data silently;
 *   receives an AbortSignal so the fetch can be cancelled
 * @param enabled — whether polling should be active (e.g. user is logged in)
 */
export function useBackgroundRefresh(
  refresh: (signal: AbortSignal) => Promise<void>,
  enabled: boolean,
): () => void {
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const doRefresh = useCallback(() => {
    // Abort any previous in-flight background request
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    refreshRef.current(ac.signal).catch(() => {
      // Swallow errors (including AbortError) — best-effort poll
    })
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current != null) return
    timerRef.current = setInterval(doRefresh, REFRESH_INTERVAL_MS)
  }, [doRefresh])

  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // invalidate: abort in-flight background request and restart timer
  const invalidate = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopTimer()
    if (enabled) startTimer()
  }, [enabled, startTimer, stopTimer])

  useEffect(() => {
    if (!enabled) return

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        doRefresh()
        startTimer()
      } else {
        stopTimer()
        abortRef.current?.abort()
        abortRef.current = null
      }
    }

    // Only start polling if the tab is currently visible; otherwise wait
    // for the first visibilitychange event to avoid wasted requests when
    // the page was opened in a background tab.
    if (document.visibilityState === 'visible') {
      startTimer()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopTimer()
      abortRef.current?.abort()
      abortRef.current = null
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, doRefresh, startTimer, stopTimer])

  return invalidate
}
