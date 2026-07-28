/**
 * React binding for the navigation-safe tile-ordering coordinator
 * (epic #975, issue #979). See `tileOrdering.ts` for the state machine.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { TileOrderItemRef } from './api'
import {
  tileOrderingCoordinator,
  type ScopeId,
  type ScopeState,
  type TileOrderStatus,
} from './tileOrdering'

export interface UseTileOrderingResult {
  /** Current save state for the scope. */
  status: TileOrderStatus
  /** Order the grid should display (newest local intent), if any. */
  displayOrder: TileOrderItemRef[] | null
  /** Report a new local order after an accepted drag. */
  reportOrder: (order: TileOrderItemRef[], generation?: number) => void
  /** Claim a grid-instance generation on mount (stale-callback guard). */
  claimGeneration: () => number
  /** Retry the newest local order after a failure. */
  retry: () => void
  /** Adopt the server's order after a conflict. */
  acceptServerOrder: () => void
  /** Reapply the newest local intent against the server's current revision. */
  reapplyLocalOrder: () => void
}

export function useTileOrdering(scope: ScopeId): UseTileOrderingResult {
  const state: ScopeState = useSyncExternalStore(
    useCallback((listener) => tileOrderingCoordinator.subscribe(listener), []),
    () => tileOrderingCoordinator.getScope(scope),
  )

  // Warn before a full browser unload while order changes are unsaved.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (tileOrderingCoordinator.hasUnsavedChanges()) {
        event.preventDefault()
        // Some browser versions only show the prompt when returnValue is set.
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return {
    status: state.status,
    displayOrder: state.displayOrder,
    reportOrder: useCallback(
      (order: TileOrderItemRef[], generation?: number) =>
        tileOrderingCoordinator.reportOrder(scope, order, generation),
      [scope],
    ),
    claimGeneration: useCallback(() => tileOrderingCoordinator.claimGeneration(scope), [scope]),
    retry: useCallback(() => tileOrderingCoordinator.retry(scope), [scope]),
    acceptServerOrder: useCallback(() => tileOrderingCoordinator.acceptServerOrder(scope), [scope]),
    reapplyLocalOrder: useCallback(() => tileOrderingCoordinator.reapplyLocalOrder(scope), [scope]),
  }
}
