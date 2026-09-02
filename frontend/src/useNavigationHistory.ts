import { useCallback, useEffect, useRef } from 'react'

/** Navigation state stored in `history.state` for back/forward support. */
export interface NavHistoryState {
  _hriv: true
  page: string
  catIds: number[]
  imageId: number | null
  /** Position assigned to app-owned history entries for guarded traversal. */
  historyIndex?: number
}

function historyIndexOf(state: unknown): number | undefined {
  if (state == null || typeof state !== 'object') return undefined
  const value = (state as Record<string, unknown>).historyIndex
  return typeof value === 'number' ? value : undefined
}

function isNavState(s: unknown): s is NavHistoryState {
  if (s == null || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  return (
    o._hriv === true &&
    typeof o.page === 'string' &&
    Array.isArray(o.catIds) &&
    (o.imageId === null || typeof o.imageId === 'number')
  )
}

/** Build a NavHistoryState object (for use with `replaceState`). */
export function buildNavHistoryState(
  page: string,
  catIds: number[],
  imageId: number | null,
  historyIndex = historyIndexOf(window.history.state) ?? 0,
): NavHistoryState {
  return { _hriv: true, page, catIds, imageId, historyIndex }
}

export interface NavigationTraversal {
  fromIndex: number
  toIndex: number
}

/**
 * Listen for `popstate` (back/forward) and provide `pushNavState` for
 * pushing new history entries on user-initiated navigation.
 */
export function useNavigationHistory(
  onPopState: (
    page: string,
    catIds: number[],
    imageId: number | null,
    traversal?: NavigationTraversal,
  ) => boolean | void,
) {
  const callbackRef = useRef(onPopState)
  const currentIndexRef = useRef(historyIndexOf(window.history.state) ?? 0)
  const restoringIndexRef = useRef<number | null>(null)
  const replayingIndexRef = useRef<number | null>(null)
  useEffect(() => {
    callbackRef.current = onPopState
  })

  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      const state = isNavState(event.state) ? event.state : null
      const targetIndex = state?.historyIndex

      if (targetIndex === restoringIndexRef.current) {
        currentIndexRef.current = targetIndex
        restoringIndexRef.current = null
        return
      }

      const page = state?.page ?? 'browse'
      const catIds = state?.catIds ?? []
      const imageId = state?.imageId ?? null
      const fromIndex = currentIndexRef.current
      const traversal = targetIndex === undefined ? undefined : { fromIndex, toIndex: targetIndex }

      if (targetIndex === replayingIndexRef.current) {
        currentIndexRef.current = targetIndex
        replayingIndexRef.current = null
        callbackRef.current(page, catIds, imageId, traversal)
        return
      }

      const accepted = traversal
        ? callbackRef.current(page, catIds, imageId, traversal)
        : callbackRef.current(page, catIds, imageId)
      if (accepted === false && targetIndex !== undefined && targetIndex !== fromIndex) {
        restoringIndexRef.current = fromIndex
        window.history.go(fromIndex - targetIndex)
        return
      }

      if (targetIndex !== undefined) currentIndexRef.current = targetIndex
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  /**
   * Push a history entry. `catIds` and `imageId` are only meaningful
   * for the "browse" page — they are stored in state but omitted from
   * the URL for other pages.
   */
  const pushNavState = useCallback(
    (page: string, catIds: number[] = [], imageId: number | null = null) => {
      const historyIndex = currentIndexRef.current + 1
      const state = buildNavHistoryState(page, catIds, imageId, historyIndex)
      const params = new URLSearchParams()
      if (page !== 'browse') {
        params.set('page', page)
      } else {
        if (catIds.length > 0) params.set('cat', catIds.join(','))
        if (imageId != null) params.set('image', String(imageId))
      }
      const qs = params.toString()
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      window.history.pushState(state, '', url)
      currentIndexRef.current = historyIndex
    },
    [],
  )

  const replayPopState = useCallback((historyIndex: number) => {
    const fromIndex = currentIndexRef.current
    if (historyIndex === fromIndex) return
    replayingIndexRef.current = historyIndex
    window.history.go(historyIndex - fromIndex)
  }, [])

  return { pushNavState, replayPopState }
}
