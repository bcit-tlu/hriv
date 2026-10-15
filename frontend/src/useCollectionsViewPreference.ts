import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** The unified Collections page's three views (#1629). */
export type CollectionsView = 'cards' | 'table' | 'graph'

/** Graph depth — mirrors `GET /api/collections/graph?order=` (#1628, #1633). */
export type CollectionsGraphOrder = 1 | 2 | 3

export interface CollectionsViewPrefs {
  view: CollectionsView
  order: CollectionsGraphOrder
  sharedOnly: boolean
}

export const DEFAULT_COLLECTIONS_VIEW_PREFS: CollectionsViewPrefs = {
  view: 'cards',
  order: 1,
  sharedOnly: false,
}

function isCollectionsGraphOrder(value: unknown): value is CollectionsGraphOrder {
  return value === 1 || value === 2 || value === 3
}

function loadStoredPrefs(
  storageKey: string,
  enablePersistence: boolean,
  initialView: CollectionsView,
): CollectionsViewPrefs {
  const defaults = { ...DEFAULT_COLLECTIONS_VIEW_PREFS, view: initialView }
  if (!enablePersistence) return defaults
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === null) return defaults
    const parsed: unknown = JSON.parse(stored)
    if (parsed == null || typeof parsed !== 'object') {
      return defaults
    }
    const record = parsed as Record<string, unknown>
    return {
      // The view is intentionally not restored — the page opens on Cards
      // (or the caller's `initialView`) while Table/Graph are being
      // evaluated (#1629 follow-up).
      view: initialView,
      order: isCollectionsGraphOrder(record.order) ? record.order : 1,
      sharedOnly: typeof record.sharedOnly === 'boolean' ? record.sharedOnly : false,
    }
  } catch {
    return defaults
  }
}

function storePrefs(storageKey: string, prefs: CollectionsViewPrefs): void {
  try {
    // `view` stays out of storage — see the load note above.
    localStorage.setItem(
      storageKey,
      JSON.stringify({ order: prefs.order, sharedOnly: prefs.sharedOnly }),
    )
  } catch {
    // Ignore localStorage write failures and fall back to in-memory state.
  }
}

/**
 * Persisted Collections-page view preferences (#1629), scoped to the
 * signed-in user (`hrivpref:*:user:<id>`) so one
 * account's view choice never carries over to the next on the same tab.
 * `enablePersistence` lets tests/stories opt out of localStorage. The view
 * is intentionally not persisted while Table/Graph are being evaluated —
 * the page always loads on Cards (#1629 follow-up); in-session view state
 * still works because the page remounts on tab switches. `initialView`
 * overrides the Cards default for one mount (old Manage → Collections links
 * land on Table).
 */
export function useCollectionsViewPreference(
  userId: number | string | null,
  {
    enablePersistence = true,
    initialView = 'cards',
  }: { enablePersistence?: boolean; initialView?: CollectionsView } = {},
): readonly [CollectionsViewPrefs, Dispatch<SetStateAction<CollectionsViewPrefs>>] {
  const storageKey = `hrivpref:collections-view:user:${userId ?? 'anonymous'}`
  const [state, setState] = useState(() => ({
    key: storageKey,
    prefs: loadStoredPrefs(storageKey, enablePersistence, initialView),
  }))
  const currentState =
    state.key === storageKey
      ? state
      : { key: storageKey, prefs: loadStoredPrefs(storageKey, enablePersistence, initialView) }

  if (state.key !== storageKey) {
    setState(currentState)
  }

  const currentPrefs = currentState.prefs
  const stateRef = useRef(currentState)
  useLayoutEffect(() => {
    stateRef.current = { key: storageKey, prefs: currentPrefs }
  }, [storageKey, currentPrefs])

  const setPrefs = useCallback<Dispatch<SetStateAction<CollectionsViewPrefs>>>(
    (nextPrefsOrUpdater) => {
      const previousState = stateRef.current
      const previousPrefs =
        previousState.key === storageKey
          ? previousState.prefs
          : loadStoredPrefs(storageKey, enablePersistence, initialView)
      const prefs =
        typeof nextPrefsOrUpdater === 'function'
          ? nextPrefsOrUpdater(previousPrefs)
          : nextPrefsOrUpdater
      const nextState = { key: storageKey, prefs }
      stateRef.current = nextState
      setState(nextState)

      if (enablePersistence) {
        storePrefs(storageKey, prefs)
      }
    },
    [enablePersistence, initialView, storageKey],
  )

  return [currentPrefs, setPrefs] as const
}
