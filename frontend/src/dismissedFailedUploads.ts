import { getStoredUserScope } from './userScope'

/**
 * Persisted set of source-image ids whose failure notification the current
 * user has dismissed. Failures live in the database indefinitely, so without
 * this the rehydrated notifications would reappear on every reload.
 */

/** Cap on stored ids so the key cannot grow without bound. */
const MAX_STORED_IDS = 200

function buildStorageKey(userScope: string): string {
  return `hrivpref:dismissed-failed-uploads:user:${userScope}`
}

export function loadDismissedFailedUploads(userScope = getStoredUserScope()): Set<number> {
  try {
    const stored = localStorage.getItem(buildStorageKey(userScope))
    if (!stored) return new Set<number>()
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return new Set<number>()
    return new Set(parsed.filter((id): id is number => typeof id === 'number'))
  } catch {
    return new Set<number>()
  }
}

export function saveDismissedFailedUploads(
  ids: Set<number>,
  userScope = getStoredUserScope(),
): void {
  const trimmed = [...ids].slice(-MAX_STORED_IDS)
  try {
    localStorage.setItem(buildStorageKey(userScope), JSON.stringify(trimmed))
  } catch {
    // Ignore storage write failures and fall back to in-memory state.
  }
}
