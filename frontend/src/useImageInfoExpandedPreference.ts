import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

function loadStoredExpanded(storageKey: string, enablePersistence: boolean): boolean {
  if (!enablePersistence) return false
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

function storeExpanded(storageKey: string, expanded: boolean): void {
  try {
    localStorage.setItem(storageKey, expanded ? '1' : '0')
  } catch {
    // Ignore localStorage write failures and fall back to in-memory state.
  }
}

export function useImageInfoExpandedPreference(
  userId: number | string | null,
  { enablePersistence = true }: { enablePersistence?: boolean } = {},
): readonly [boolean, Dispatch<SetStateAction<boolean>>] {
  const storageKey = `hrivpref:image-info-expanded:user:${userId ?? 'anonymous'}`
  const [state, setState] = useState(() => ({
    key: storageKey,
    expanded: loadStoredExpanded(storageKey, enablePersistence),
  }))
  const currentState =
    state.key === storageKey
      ? state
      : { key: storageKey, expanded: loadStoredExpanded(storageKey, enablePersistence) }

  if (state.key !== storageKey) {
    setState(currentState)
  }

  const currentExpanded = currentState.expanded
  const stateRef = useRef(currentState)
  useLayoutEffect(() => {
    stateRef.current = { key: storageKey, expanded: currentExpanded }
  }, [storageKey, currentExpanded])

  const setExpanded = useCallback<Dispatch<SetStateAction<boolean>>>(
    (nextExpandedOrUpdater) => {
      const previousState = stateRef.current
      const previousExpanded =
        previousState.key === storageKey
          ? previousState.expanded
          : loadStoredExpanded(storageKey, enablePersistence)
      const expanded =
        typeof nextExpandedOrUpdater === 'function'
          ? nextExpandedOrUpdater(previousExpanded)
          : nextExpandedOrUpdater
      const nextState = { key: storageKey, expanded }
      stateRef.current = nextState
      setState(nextState)

      if (enablePersistence) {
        storeExpanded(storageKey, expanded)
      }
    },
    [enablePersistence, storageKey],
  )

  return [currentState.expanded, setExpanded] as const
}
