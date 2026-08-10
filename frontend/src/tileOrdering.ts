/**
 * Navigation-safe tile-ordering coordinator (epic #975, issue #979).
 *
 * Owns the reorder persistence lifecycle for every Browse scope (the root or
 * one parent category) ABOVE the grid component, so pending state survives
 * grid unmount/remount (SPA navigation). The grid applies each accepted drag
 * locally and reports the new order here; it never calls persistence APIs
 * directly and no accepted drop is ever discarded.
 *
 * Persistence uses the atomic `PUT /api/tile-order` contract
 * (docs/tile-ordering.md): one request per scope carrying the full ordered
 * item list plus an `expected_revision` compare-and-set token. Drops that
 * land while a save is in flight are coalesced — only the newest local
 * snapshot is submitted next, never one request per drop.
 */

import {
  getTileOrder,
  putTileOrder,
  tileOrderConflictCurrent,
  ApiError,
  type TileOrderItemRef,
  type TileOrderResponse,
} from './api'
import {
  emitReorderDiagnostic,
  newReorderOperationId,
  reorderErrorCode,
} from './reorderDiagnostics'

/** Save-state vocabulary shown to the user (see issue #979). */
export type TileOrderStatus =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'dirty-while-saving'
  | 'saved'
  | 'conflict'
  | 'error'

/** Ordering scope key: the parent category ID, or null for the root scope. */
export type ScopeId = number | null

/**
 * Details of the drag that produced a reported order, forwarded into the
 * lifecycle telemetry so operators keep per-drag detail (which tile moved,
 * from where, to where) even though persistence submits the whole scope.
 */
export interface ReorderDragContext {
  itemType: 'category' | 'image'
  itemId: number
  fromIndex: number
  toIndex: number
}

export interface ScopeState {
  status: TileOrderStatus
  /** Last revision returned by the server for this scope (CAS token). */
  revision: number | null
  /** Newest local order not yet submitted (coalesces intermediate drops). */
  pending: TileOrderItemRef[] | null
  /** Order currently being persisted. */
  inFlight: TileOrderItemRef[] | null
  /**
   * The order the UI should display: the newest local intent, falling back
   * to the last authoritative server order. Null until the first drop or
   * server response for the scope.
   */
  displayOrder: TileOrderItemRef[] | null
  /** Authoritative server order captured from a 409 conflict. */
  conflictOrder: TileOrderItemRef[] | null
  error: unknown
}

// Shared initial snapshot: `getScope` must be referentially stable for
// unknown scopes (`useSyncExternalStore` compares snapshots by identity).
const INITIAL_SCOPE_STATE: ScopeState = Object.freeze({
  status: 'idle',
  revision: null,
  pending: null,
  inFlight: null,
  displayOrder: null,
  conflictOrder: null,
  error: null,
})

function scopeKey(scope: ScopeId): string {
  return scope === null ? 'root' : String(scope)
}

function sameOrder(a: TileOrderItemRef[], b: TileOrderItemRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.type === b[i].type && ref.id === b[i].id)
}

function refsOf(response: TileOrderResponse): TileOrderItemRef[] {
  return response.items.map(({ type, id }) => ({ type, id }))
}

export class TileOrderingCoordinator {
  private scopes = new Map<string, ScopeState>()
  private listeners = new Set<() => void>()
  /**
   * Monotonic grid-instance generation per scope. A remounting grid claims a
   * new generation; callbacks carrying an older generation are ignored so an
   * unmounted grid can never overwrite its replacement.
   */
  private generations = new Map<string, number>()
  /** Scopes whose initial revision is being fetched (dedupes seeding GETs). */
  private seeding = new Set<string>()
  /**
   * Operation ID minted when a snapshot is queued behind an in-flight save,
   * carried through coalescing to the eventual submission so the queued /
   * coalesced / submitted / terminal events of one operation correlate.
   */
  private pendingOperationIds = new Map<string, string>()
  /**
   * Bumped by `reset()`. In-flight `flush` continuations capture the epoch
   * at entry and bail out if it changed, so a save that settles after a
   * logout/user-switch reset can never recreate the previous user's state.
   */
  private epoch = 0
  /** Monotonic write counter; stamps each scope write (see `marker`). */
  private writeCounter = 0
  /** Per-scope-key sequence of the most recent write. */
  private lastWrite = new Map<string, number>()
  /**
   * Drag detail of the newest reported drop per scope, attached to the next
   * `submitted` emission. Coalesced drops keep the latest drag's detail.
   */
  private dragContexts = new Map<string, ReorderDragContext>()
  /** Notified after each successful commit (see `onCommitted`). */
  private commitListeners = new Set<(scope: ScopeId) => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Subscribe to successful commits. The app refreshes its shared category
   * tree / uncategorized-image data on commit so every consumer of that data
   * (e.g. Manage Categories) sees the just-saved order instead of stale
   * pre-save positions it could silently write back. Returns an unsubscribe.
   */
  onCommitted(listener: (scope: ScopeId) => void): () => void {
    this.commitListeners.add(listener)
    return () => this.commitListeners.delete(listener)
  }

  getScope(scope: ScopeId): ScopeState {
    return this.scopes.get(scopeKey(scope)) ?? INITIAL_SCOPE_STATE
  }

  /** True when any scope holds unsaved or in-flight changes (unload guard). */
  hasUnsavedChanges(): boolean {
    for (const state of this.scopes.values()) {
      if (
        state.pending !== null ||
        state.inFlight !== null ||
        state.status === 'dirty' ||
        state.status === 'error'
      ) {
        return true
      }
    }
    return false
  }

  /**
   * Drop cached order state for every clean scope so freshly fetched
   * authoritative data wins (order changes made elsewhere — another
   * client or another surface — become visible on the next refresh).
   * Scopes holding local intent (pending, in-flight, conflict, or a
   * retryable failure) are left untouched.
   */
  releaseCleanScopes(marker?: number): void {
    let changed = false
    for (const [key, state] of this.scopes) {
      // Skip scopes written after the caller's marker: their order is newer
      // than whatever data the caller fetched, so it must not be discarded.
      if (marker !== undefined && (this.lastWrite.get(key) ?? 0) > marker) continue
      if (
        state.pending === null &&
        state.inFlight === null &&
        (state.status === 'saved' || state.status === 'idle')
      ) {
        this.scopes.delete(key)
        this.lastWrite.delete(key)
        changed = true
      }
    }
    if (changed) for (const listener of this.listeners) listener()
  }

  /**
   * Snapshot of the write counter. Capture before starting a data refresh
   * and pass to `releaseCleanScopes` so scopes saved while the refresh was
   * in flight (whose order is newer than the fetched data) survive.
   */
  marker(): number {
    return this.writeCounter
  }

  /**
   * Forget all per-scope state. Called on logout/user switch so cached
   * orders, revisions, and unsaved-change flags never leak to the next
   * user on a shared browser.
   */
  reset(): void {
    this.epoch += 1
    this.seeding.clear()
    this.dragContexts.clear()
    this.lastWrite.clear()
    if (this.scopes.size === 0 && this.pendingOperationIds.size === 0) return
    this.scopes.clear()
    this.pendingOperationIds.clear()
    for (const listener of this.listeners) listener()
  }

  /** Claim a new grid generation for a scope (called on grid mount). */
  claimGeneration(scope: ScopeId): number {
    const key = scopeKey(scope)
    const next = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, next)
    return next
  }

  isCurrentGeneration(scope: ScopeId, generation: number): boolean {
    return (this.generations.get(scopeKey(scope)) ?? 0) === generation
  }

  /**
   * Record a new local order for a scope and schedule persistence.
   * Every accepted drop lands here; drops during an active save are queued
   * (coalescing any previously queued snapshot) — never discarded.
   */
  reportOrder(
    scope: ScopeId,
    order: TileOrderItemRef[],
    generation?: number,
    dragContext?: ReorderDragContext,
  ): void {
    if (generation !== undefined && !this.isCurrentGeneration(scope, generation)) return
    const state = this.getScope(scope)
    if (state.displayOrder !== null && sameOrder(state.displayOrder, order)) return
    if (dragContext !== undefined) this.dragContexts.set(scopeKey(scope), dragContext)

    // Treat revision seeding like an in-flight save: the drop is queued so
    // the status stays 'saving'-family instead of flickering back to dirty,
    // and queued/coalesced telemetry is emitted for it.
    if (state.inFlight !== null || this.seeding.has(scopeKey(scope))) {
      const key = scopeKey(scope)
      if (state.pending !== null) {
        const operationId = this.pendingOperationIds.get(key) ?? newReorderOperationId()
        this.pendingOperationIds.set(key, operationId)
        emitReorderDiagnostic({
          operationId,
          state: 'coalesced',
          scopeCategoryId: scope,
          queueDepth: 1,
        })
      } else {
        const operationId = newReorderOperationId()
        this.pendingOperationIds.set(key, operationId)
        emitReorderDiagnostic({
          operationId,
          state: 'queued',
          scopeCategoryId: scope,
          queueDepth: 1,
        })
      }
      this.setScope(scope, {
        ...state,
        status: 'dirty-while-saving',
        pending: order,
        displayOrder: order,
      })
      return
    }

    this.setScope(scope, {
      ...state,
      status: 'dirty',
      pending: order,
      displayOrder: order,
      error: null,
    })
    void this.flush(scope)
  }

  /** Retry persisting the newest local order after a failure. */
  retry(scope: ScopeId): void {
    const state = this.getScope(scope)
    if (state.status !== 'error' || state.pending === null || state.inFlight !== null) return
    this.setScope(scope, { ...state, status: 'dirty', error: null })
    void this.flush(scope)
  }

  /**
   * Resolve a conflict by adopting the server's authoritative order.
   * Local intent is replaced — the caller surfaces this as "Order changed
   * elsewhere" and the user explicitly accepts the refresh.
   */
  acceptServerOrder(scope: ScopeId): void {
    const state = this.getScope(scope)
    if (state.status !== 'conflict') return
    this.setScope(scope, {
      ...state,
      status: 'saved',
      pending: null,
      displayOrder: state.conflictOrder ?? state.displayOrder,
      conflictOrder: null,
      error: null,
    })
  }

  private setScope(scope: ScopeId, state: ScopeState): void {
    const key = scopeKey(scope)
    this.scopes.set(key, state)
    this.lastWrite.set(key, ++this.writeCounter)
    for (const listener of this.listeners) listener()
  }

  private async flush(scope: ScopeId): Promise<void> {
    const epoch = this.epoch
    // Persist snapshots until no newer local changes remain. Each iteration
    // submits the newest snapshot only (coalescing anything in between).
    for (;;) {
      if (epoch !== this.epoch) return
      const state = this.getScope(scope)
      if (state.pending === null || state.inFlight !== null) return
      if (this.seeding.has(scopeKey(scope))) return
      const order = state.pending

      let revision = state.revision
      if (revision === null) {
        this.seeding.add(scopeKey(scope))
        this.setScope(scope, { ...state, status: 'saving' })
        const seedOperationId = newReorderOperationId()
        const seedStartedAt = performance.now()
        try {
          const current = await getTileOrder(scope)
          revision = current.revision
        } catch (err) {
          if (epoch !== this.epoch) return
          emitReorderDiagnostic({
            operationId: seedOperationId,
            state: 'failed',
            scopeCategoryId: scope,
            durationMs: performance.now() - seedStartedAt,
            errorCode: reorderErrorCode(err),
          })
          this.setScope(scope, {
            ...this.getScope(scope),
            status: 'error',
            error: err,
          })
          return
        } finally {
          // Epoch-guarded: after a reset() a new flush may have re-marked
          // this scope as seeding; a stale flush must not clear that mark
          // (it would allow two concurrent flush loops for one scope).
          if (epoch === this.epoch) this.seeding.delete(scopeKey(scope))
        }
        if (epoch !== this.epoch) return
        // A newer snapshot may have arrived while fetching the revision.
        const latest = this.getScope(scope)
        this.setScope(scope, { ...latest, revision })
        continue
      }

      // Reuse the ID minted when this snapshot was queued (if any) so the
      // queued/coalesced events correlate with submission and completion.
      const queuedOperationId = this.pendingOperationIds.get(scopeKey(scope))
      this.pendingOperationIds.delete(scopeKey(scope))
      const drag = this.dragContexts.get(scopeKey(scope))
      this.dragContexts.delete(scopeKey(scope))
      const operationId = queuedOperationId ?? newReorderOperationId()
      const startedAt = performance.now()
      this.setScope(scope, {
        ...state,
        status: 'saving',
        pending: null,
        inFlight: order,
      })
      const categoryCount = order.filter((r) => r.type === 'category').length
      const imageCount = order.filter((r) => r.type === 'image').length
      emitReorderDiagnostic({
        operationId,
        state: 'submitted',
        scopeCategoryId: scope,
        // Persistence re-indexes the whole scope: 'mixed' when the scope
        // holds both kinds, otherwise the dragged tile's type.
        itemType: categoryCount > 0 && imageCount > 0 ? 'mixed' : drag?.itemType,
        itemId: drag?.itemId,
        fromIndex: drag?.fromIndex,
        toIndex: drag?.toIndex,
        categoryCount,
        imageCount,
        queueDepth: 0,
        localRevision: revision,
      })

      try {
        const response = await putTileOrder(scope, revision, order, operationId)
        if (epoch !== this.epoch) return
        emitReorderDiagnostic({
          operationId,
          state: 'committed',
          scopeCategoryId: scope,
          durationMs: performance.now() - startedAt,
          localRevision: response.revision,
        })
        const after = this.getScope(scope)
        const stillNewest = after.pending === null
        this.setScope(scope, {
          ...after,
          status: stillNewest ? 'saved' : 'dirty',
          revision: response.revision,
          inFlight: null,
          // Only adopt the authoritative order when no newer local intent
          // accumulated during the save — never roll back newer changes.
          displayOrder: stillNewest ? refsOf(response) : after.displayOrder,
        })
        for (const listener of this.commitListeners) {
          try {
            listener(scope)
          } catch {
            /* a bad listener must never break the save loop */
          }
        }
        if (stillNewest) return
        continue
      } catch (err) {
        if (epoch !== this.epoch) return
        // 409: the CAS revision is stale. 400: scope membership changed
        // underneath the client (membership changes do not bump the
        // revision) — the tile-order contract says to treat it like 409 and
        // refresh via GET (docs/tile-ordering.md).
        let conflict = tileOrderConflictCurrent(err)
        if (conflict === null && err instanceof ApiError && err.status === 400) {
          try {
            conflict = await getTileOrder(scope)
          } catch {
            conflict = null
          }
          if (epoch !== this.epoch) return
        }
        if (conflict !== null) {
          emitReorderDiagnostic({
            operationId,
            state: 'conflicted',
            scopeCategoryId: scope,
            durationMs: performance.now() - startedAt,
            localRevision: conflict.revision,
          })
          const after = this.getScope(scope)
          this.setScope(scope, {
            ...after,
            status: 'conflict',
            revision: conflict.revision,
            inFlight: null,
            // Retain the newest local intent for explicit user resolution.
            pending: after.pending ?? order,
            conflictOrder: refsOf(conflict),
            error: err,
          })
          return
        }
        emitReorderDiagnostic({
          operationId,
          state: 'failed',
          scopeCategoryId: scope,
          durationMs: performance.now() - startedAt,
          errorCode: reorderErrorCode(err),
        })
        const after = this.getScope(scope)
        this.setScope(scope, {
          ...after,
          status: 'error',
          inFlight: null,
          // Keep the newest local intent retryable.
          pending: after.pending ?? order,
          error: err,
        })
        return
      }
    }
  }
}

/**
 * Module-level coordinator instance: state intentionally outlives any React
 * component so pending saves survive SPA navigation and grid remounts.
 */
export const tileOrderingCoordinator = new TileOrderingCoordinator()
