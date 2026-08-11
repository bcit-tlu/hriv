import { useCallback, useEffect, useRef } from 'react'
import type { User } from './types'

/**
 * Decide whether an auth-state transition is a *real* user switch — i.e. one
 * that should reset navigation (page/path/selected image) and strip the
 * shareable URL to prevent cross-account leakage.
 *
 * It returns false for:
 *  - the initial `null → user` auth bootstrap after a page reload (session
 *    restore), so the URL-derived page/`?cat=` state survives (#577), and
 *  - a same-identity re-fetch that yields a *new* `User` object with the same
 *    `id`. React StrictMode double-invokes the token-validation effect in dev,
 *    firing `/api/auth/me` twice and producing two distinct `User` objects for
 *    the same account; comparing by object reference (`prevUser !== currentUser`)
 *    would treat the second as a switch and wipe the just-restored `?cat=` URL,
 *    dumping the student back at the browse root on every reload (#770).
 *
 * It returns true for a genuine account change (different `id`) and for logout
 * (`user → null`).
 */
export function isRealUserSwitch(prevUser: User | null, currentUser: User | null): boolean {
  if (prevUser == null) return false
  if (currentUser == null) return true
  return prevUser.id !== currentUser.id
}

/** Navigation state stored in `history.state` for back/forward support. */
export interface NavHistoryState {
  _hriv: true
  page: string
  catIds: number[]
  imageId: number | null
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
): NavHistoryState {
  return { _hriv: true, page, catIds, imageId }
}

/**
 * Listen for `popstate` (back/forward) and provide `pushNavState` for
 * pushing new history entries on user-initiated navigation.
 */
export function useNavigationHistory(
  onPopState: (page: string, catIds: number[], imageId: number | null) => void,
) {
  const callbackRef = useRef(onPopState)
  useEffect(() => {
    callbackRef.current = onPopState
  })

  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      if (isNavState(event.state)) {
        callbackRef.current(event.state.page, event.state.catIds, event.state.imageId)
      } else {
        callbackRef.current('browse', [], null)
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
      const state = buildNavHistoryState(page, catIds, imageId)
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
    },
    [],
  )

  return { pushNavState }
}
