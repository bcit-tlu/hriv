/**
 * Shared helpers for the object-counting UI (epic #1661): labels, error
 * tables/severities, progress captions and the viewport -> level-0 rect
 * conversion used before POSTing a count.
 */

import OpenSeadragon from 'openseadragon'

import type { ApiCountSelection } from './api'
import type { CountErrorCode, SelectionCountEntry } from './useSelectionCounts'

export interface CountSelectionRect {
  key: number
  /** 1-based index used for labels ("Selection 2"). */
  index: number
  /** Rect in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number }
}

const MODE_LABEL: Record<string, string> = { cells: 'Cells', nuclei: 'Nuclei' }

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode
}

const ERROR_MESSAGES: Record<CountErrorCode, string> = {
  too_large: 'Selection too large — draw a smaller box or zoom in.',
  rate_limited: 'You already have counts running. Wait for one to finish.',
  unavailable: 'Object counting is unavailable right now. Try again later.',
  tiles_not_ready: "This image can't be counted yet.",
  invalid_selection: 'Draw the selection over the image.',
  too_many_objects: 'Too many objects to count — draw a smaller box.',
  expired: 'Count results expired. Count again.',
  timeout: 'Counting failed.',
  no_tiles: 'Counting failed.',
  internal: 'Counting failed.',
}

const WARNING_CODES: ReadonlySet<CountErrorCode> = new Set([
  'too_large',
  'rate_limited',
  'too_many_objects',
  'expired',
])

const RETRYABLE_CODES: ReadonlySet<CountErrorCode> = new Set(['timeout', 'no_tiles', 'internal'])

export function countErrorMessage(code: CountErrorCode): string {
  return ERROR_MESSAGES[code]
}

export function countErrorSeverity(code: CountErrorCode): 'warning' | 'error' {
  return WARNING_CODES.has(code) ? 'warning' : 'error'
}

export function countErrorRetryable(code: CountErrorCode): boolean {
  return RETRYABLE_CODES.has(code)
}

export function activeCountCaption(entry: SelectionCountEntry): string {
  const mode = modeLabel(entry.mode)
  if (entry.phase === 'queued') {
    const ahead = entry.queuePosition ?? 0
    return ahead > 0
      ? `${entry.label} · ${mode} — waiting in queue (${ahead} ahead)`
      : `${entry.label} · ${mode} — waiting in queue`
  }
  return `${entry.label} · ${mode} — finding and outlining objects…`
}

/** Convert a drawn selection rect (viewport coords) to a clamped level-0
 * selection for ``POST /api/images/{id}/counts``. */
export function selectionToLevel0(
  viewer: OpenSeadragon.Viewer,
  rect: { x: number; y: number; width: number; height: number },
): ApiCountSelection | null {
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const r = viewer.viewport.viewportToImageRectangle(
    new OpenSeadragon.Rect(rect.x, rect.y, rect.width, rect.height),
  )
  const size = item.getContentSize()
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const width = Math.min(size.x - x, Math.ceil(r.width))
  const height = Math.min(size.y - y, Math.ceil(r.height))
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}
