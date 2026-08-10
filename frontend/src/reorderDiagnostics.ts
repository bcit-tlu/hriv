/**
 * Reorder operation diagnostics (epic #975, issue #977).
 *
 * Every ordering operation gets a client-generated `operation_id` that is:
 * - attached to the `PUT /api/tile-order` request body as `operation_id`
 *   (picked up by backend spans and structured logs);
 * - emitted with each lifecycle state transition as a structured
 *   `reorder.operation` telemetry event (backend-validated ingestion);
 * - mirrored to the console in dev for quick local debugging.
 *
 * The state vocabulary mirrors `backend/app/reorder_metrics.py`
 * (`REORDER_CLIENT_STATES`), which additionally accepts an `other` sentinel
 * that unrecognized states are coerced to server-side.
 */

import { ApiError } from './api'
import { emitEvent } from './observability'
import type { TelemetryErrorCode } from './observability'

/** Lifecycle states of one client-side reorder operation. */
export const REORDER_OPERATION_STATES = [
  /** A drop was accepted visually but discarded by the in-flight guard. */
  'ignored',
  /** A drop was accepted and is waiting behind an in-flight save. */
  'queued',
  /** A queued drop was merged into a newer one before submission. */
  'coalesced',
  /** Persistence requests were sent to the backend. */
  'submitted',
  /** Persistence completed successfully (a failed follow-up refresh is handled by the refresh callback, not reflected here). */
  'committed',
  /** The backend rejected the operation due to a revision conflict. */
  'conflicted',
  /** Persistence failed (fully or partially) and the UI rolled back. */
  'failed',
  /** A refresh response was discarded because a newer operation superseded it. */
  'stale_discarded',
  /** The component unmounted (navigation) while the operation was active. */
  'abandoned',
] as const

export type ReorderOperationState = (typeof REORDER_OPERATION_STATES)[number]

export interface ReorderDiagnosticEvent {
  operationId: string
  state: ReorderOperationState
  /** Ordering scope: parent category ID, or null for the root scope. */
  scopeCategoryId?: number | null
  /**
   * Dragged item type for `ignored` events. For `submitted` and later
   * states it reflects the persisted scope: 'mixed' whenever the scope
   * contains both categories and images (persistence re-indexes the whole
   * scope), regardless of which single tile was dragged.
   */
  itemType?: 'category' | 'image' | 'mixed'
  /** Moved item ID (single-item moves only). */
  itemId?: number
  fromIndex?: number
  toIndex?: number
  categoryCount?: number
  imageCount?: number
  queueDepth?: number
  localRevision?: number
  durationMs?: number
  /** Bounded error category (never a free-text exception message). */
  errorCode?: TelemetryErrorCode
}

type ReorderDiagnosticListener = (event: ReorderDiagnosticEvent) => void

const listeners = new Set<ReorderDiagnosticListener>()

/**
 * Map a persistence failure to the bounded telemetry error vocabulary; raw
 * exception text stays in the console, never in ingested telemetry.
 */
export function reorderErrorCode(err: unknown): TelemetryErrorCode {
  if (err instanceof ApiError) {
    return err.status >= 500 ? 'api_http_5xx' : 'api_http_4xx'
  }
  return 'api_network_error'
}

/** Generate a new correlation ID for one ordering operation. */
export function newReorderOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Subscribe to diagnostic events (tests, future save-state UX). Returns an unsubscribe. */
export function subscribeReorderDiagnostics(listener: ReorderDiagnosticListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emit one reorder lifecycle state transition. */
export function emitReorderDiagnostic(event: ReorderDiagnosticEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* a bad listener must never break the reorder flow */
    }
  }
  if (import.meta.env?.DEV) {
    console.debug('[reorder]', event.state, event)
  }
  emitEvent({
    event: 'reorder.operation',
    outcome:
      event.state === 'committed'
        ? 'success'
        : event.state === 'failed' || event.state === 'conflicted'
          ? 'failure'
          : 'unknown',
    operation_id: event.operationId,
    state: event.state,
    item_type: event.itemType,
    category_id: event.scopeCategoryId ?? undefined,
    // Type-agnostic dragged-tile ID so the moved item stays identifiable even
    // for `mixed` scopes and category moves; `image_id` is kept additionally
    // for image moves so the ingestion display-name lookup still resolves.
    item_id: event.itemId,
    image_id: event.itemType === 'image' ? event.itemId : undefined,
    from_index: event.fromIndex,
    to_index: event.toIndex,
    category_count: event.categoryCount,
    image_count: event.imageCount,
    queue_depth: event.queueDepth,
    local_revision: event.localRevision,
    duration_ms: event.durationMs,
    error: event.errorCode,
    error_code: event.errorCode,
  })
}
