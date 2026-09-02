import { useCallback, useEffect, useRef } from 'react'

/** Navigation state stored in `history.state` for back/forward support. */
export interface NavHistoryState {
  _hriv: true
  page: string
  catIds: number[]
  imageId: number | null
  /** Position assigned to app-owned history entries for guarded traversal. */
  historyIndex?: number
  /** Identifies entries whose numeric positions belong to the same history segment. */
  historyKey?: string
}

const historySessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
let historyGeneration = 0

function currentHistoryKey(): string {
  return `${historySessionId}:${historyGeneration}`
}

function startHistoryGeneration(): string {
  historyGeneration += 1
  return currentHistoryKey()
}

function historyIndexOf(state: unknown): number | undefined {
  if (state == null || typeof state !== 'object') return undefined
  const record = state as Record<string, unknown>
  if (record.historyKey !== currentHistoryKey()) return undefined
  const value = record.historyIndex
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
  return {
    _hriv: true,
    page,
    catIds,
    imageId,
    historyIndex,
    historyKey: currentHistoryKey(),
  }
}

export interface NavigationTraversal {
  fromIndex: number
  toIndex?: number
}

interface HistoryEntrySnapshot {
  state: unknown
  url: string
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
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
  const currentEntryRef = useRef<HistoryEntrySnapshot>({
    state: window.history.state,
    url: currentUrl(),
  })
  const pendingLegacyEntryRef = useRef(false)
  const replayingLegacyEntryRef = useRef(false)
  useEffect(() => {
    callbackRef.current = onPopState
    currentEntryRef.current = {
      state: window.history.state,
      url: currentUrl(),
    }
  })

  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      const state = isNavState(event.state) ? event.state : null
      const targetIndex = historyIndexOf(state)

      if (targetIndex === restoringIndexRef.current) {
        currentIndexRef.current = targetIndex
        restoringIndexRef.current = null
        currentEntryRef.current = {
          state: event.state,
          url: currentUrl(),
        }
        return
      }

      const page = state?.page ?? 'browse'
      const catIds = state?.catIds ?? []
      const imageId = state?.imageId ?? null
      const fromIndex = currentIndexRef.current
      const traversal =
        targetIndex === undefined
          ? state
            ? { fromIndex }
            : undefined
          : { fromIndex, toIndex: targetIndex }

      if (replayingLegacyEntryRef.current && state) {
        const migratedIndex = fromIndex - 1
        const migratedState: NavHistoryState = {
          ...state,
          historyIndex: migratedIndex,
          historyKey: currentHistoryKey(),
        }
        window.history.replaceState(migratedState, '', currentUrl())
        currentIndexRef.current = migratedIndex
        currentEntryRef.current = {
          state: migratedState,
          url: currentUrl(),
        }
        replayingLegacyEntryRef.current = false
        callbackRef.current(page, catIds, imageId, {
          fromIndex,
          toIndex: migratedIndex,
        })
        return
      }

      if (targetIndex === replayingIndexRef.current) {
        currentIndexRef.current = targetIndex
        replayingIndexRef.current = null
        currentEntryRef.current = {
          state: event.state,
          url: currentUrl(),
        }
        callbackRef.current(page, catIds, imageId, traversal!)
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
      if (accepted === false && traversal && targetIndex === undefined) {
        // A legacy entry has no trustworthy offset. Preserve it at the current
        // cursor and push the displayed editor immediately after it, avoiding
        // any direction probe that could cross into another document.
        const currentEntry = currentEntryRef.current
        const restoredIndex = 1
        const historyKey = startHistoryGeneration()
        const restoredState = isNavState(currentEntry.state)
          ? {
              ...currentEntry.state,
              historyIndex: restoredIndex,
              historyKey,
            }
          : currentEntry.state
        window.history.pushState(restoredState, '', currentEntry.url)
        currentIndexRef.current = restoredIndex
        currentEntryRef.current = {
          state: restoredState,
          url: currentEntry.url,
        }
        pendingLegacyEntryRef.current = true
        return
      }

      if (targetIndex !== undefined) {
        currentIndexRef.current = targetIndex
      } else if (state) {
        const historyKey = pendingLegacyEntryRef.current
          ? currentHistoryKey()
          : startHistoryGeneration()
        const migratedState: NavHistoryState = {
          ...state,
          historyIndex: 0,
          historyKey,
        }
        pendingLegacyEntryRef.current = false
        window.history.replaceState(migratedState, '', currentUrl())
        currentIndexRef.current = 0
        currentEntryRef.current = {
          state: migratedState,
          url: currentUrl(),
        }
        return
      }
      currentEntryRef.current = {
        state: event.state,
        url: currentUrl(),
      }
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
      currentEntryRef.current = { state, url }
      pendingLegacyEntryRef.current = false
    },
    [],
  )

  const replayPopState = useCallback((historyIndex?: number) => {
    const fromIndex = currentIndexRef.current
    if (historyIndex === undefined) {
      if (!pendingLegacyEntryRef.current) return
      pendingLegacyEntryRef.current = false
      replayingLegacyEntryRef.current = true
      // The guarded legacy destination is now known to be exactly one entry back.
      window.history.back()
      return
    }
    if (historyIndex === fromIndex) return
    replayingIndexRef.current = historyIndex
    window.history.go(historyIndex - fromIndex)
  }, [])

  return { pushNavState, replayPopState }
}
