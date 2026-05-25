import { useEffect, useRef } from 'react'

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
 * @param refresh — async function that re-fetches data silently
 * @param enabled — whether polling should be active (e.g. user is logged in)
 */
export function useBackgroundRefresh(
  refresh: () => Promise<void>,
  enabled: boolean,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setInterval> | null = null

    function start() {
      if (timer != null) return
      timer = setInterval(() => {
        refreshRef.current().catch(() => {
          // Swallow errors — this is a best-effort background poll
        })
      }, REFRESH_INTERVAL_MS)
    }

    function stop() {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Tab became visible — refresh immediately then restart interval
        refreshRef.current().catch(() => {})
        start()
      } else {
        stop()
      }
    }

    // Start polling immediately
    start()

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled])
}
