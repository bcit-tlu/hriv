/**
 * React binding for the navigation-safe tile-ordering coordinator
 * (epic #975, issue #979). See `tileOrdering.ts` for the state machine.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { TileOrderItemRef } from './api'
import {
  tileOrderingCoordinator,
  type ReorderDragContext,
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
  reportOrder: (
    order: TileOrderItemRef[],
    generation?: number,
    dragContext?: ReorderDragContext,
  ) => void
  /** Claim a grid-instance generation on mount (stale-callback guard). */
  claimGeneration: () => number
  /** Retry the newest local order after a failure. */
  retry: () => void
  /** Adopt the server's order after a conflict. */
  acceptServerOrder: () => void
  /**
   * True while an authoritative server order is retained (a conflict, or a
   * failed "keep my order" retry), so the UI can offer accepting it.
   */
  serverOrderAvailable: boolean
  /** Reapply the newest local intent against the server's current revision. */
  reapplyLocalOrder: () => void
}

/** Higher = more urgently needs the user's attention. */
const STATUS_SEVERITY: Record<TileOrderStatus, number> = {
  conflict: 6,
  error: 5,
  'dirty-while-saving': 4,
  saving: 3,
  dirty: 2,
  saved: 1,
  idle: 0,
}

/**
 * Pick the scope whose save state most urgently needs attention (e.g. a
 * cross-parent move touches both the source and destination scopes, and a
 * single indicator should surface whichever one is conflicted or failed).
 * Returns `undefined` when no scopes are tracked.
 */
export function useMostSevereScope(scopes: ScopeId[] | null): ScopeId | undefined {
  return useSyncExternalStore(
    useCallback((listener) => tileOrderingCoordinator.subscribe(listener), []),
    () => {
      if (!scopes || scopes.length === 0) return undefined
      let best = scopes[0]
      let bestSeverity = -1
      for (const scope of scopes) {
        const severity = STATUS_SEVERITY[tileOrderingCoordinator.getScope(scope).status]
        if (severity > bestSeverity) {
          bestSeverity = severity
          best = scope
        }
      }
      return best
    },
  )
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
    serverOrderAvailable: state.conflictOrder !== null,
    reportOrder: useCallback(
      (order: TileOrderItemRef[], generation?: number, dragContext?: ReorderDragContext) =>
        tileOrderingCoordinator.reportOrder(scope, order, generation, dragContext),
      [scope],
    ),
    claimGeneration: useCallback(() => tileOrderingCoordinator.claimGeneration(scope), [scope]),
    retry: useCallback(() => tileOrderingCoordinator.retry(scope), [scope]),
    acceptServerOrder: useCallback(() => tileOrderingCoordinator.acceptServerOrder(scope), [scope]),
    reapplyLocalOrder: useCallback(() => tileOrderingCoordinator.reapplyLocalOrder(scope), [scope]),
  }
}
