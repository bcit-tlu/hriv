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

function isCollectionsView(value: unknown): value is CollectionsView {
  return value === 'cards' || value === 'table' || value === 'graph'
}

function isCollectionsGraphOrder(value: unknown): value is CollectionsGraphOrder {
  return value === 1 || value === 2 || value === 3
}

function loadStoredPrefs(storageKey: string, enablePersistence: boolean): CollectionsViewPrefs {
  if (!enablePersistence) return { ...DEFAULT_COLLECTIONS_VIEW_PREFS }
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === null) return { ...DEFAULT_COLLECTIONS_VIEW_PREFS }
    const parsed: unknown = JSON.parse(stored)
    if (parsed == null || typeof parsed !== 'object') {
      return { ...DEFAULT_COLLECTIONS_VIEW_PREFS }
    }
    const record = parsed as Record<string, unknown>
    return {
      view: isCollectionsView(record.view) ? record.view : 'cards',
      order: isCollectionsGraphOrder(record.order) ? record.order : 1,
      sharedOnly: typeof record.sharedOnly === 'boolean' ? record.sharedOnly : false,
    }
  } catch {
    return { ...DEFAULT_COLLECTIONS_VIEW_PREFS }
  }
}

function storePrefs(storageKey: string, prefs: CollectionsViewPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs))
  } catch {
    // Ignore localStorage write failures and fall back to in-memory state.
  }
}

/**
 * Persisted Collections-page view preferences (#1629), modelled on
 * `useImageInfoExpandedPreference`: scoped to the signed-in user so one
 * account's view choice never carries over to the next on the same tab.
 * `enablePersistence` lets tests/stories opt out of localStorage.
 */
export function useCollectionsViewPreference(
  userId: number | string | null,
  { enablePersistence = true }: { enablePersistence?: boolean } = {},
): readonly [CollectionsViewPrefs, Dispatch<SetStateAction<CollectionsViewPrefs>>] {
  const storageKey = `hrivpref:collections-view:user:${userId ?? 'anonymous'}`
  const [state, setState] = useState(() => ({
    key: storageKey,
    prefs: loadStoredPrefs(storageKey, enablePersistence),
  }))
  const currentState =
    state.key === storageKey
      ? state
      : { key: storageKey, prefs: loadStoredPrefs(storageKey, enablePersistence) }

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
          : loadStoredPrefs(storageKey, enablePersistence)
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
    [enablePersistence, storageKey],
  )

  return [currentPrefs, setPrefs] as const
}
