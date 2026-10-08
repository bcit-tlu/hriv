import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCollections } from './api'
import { apiCollectionSummaryToSummary } from './collectionUtils'
import type { CollectionSummary } from './types'

/**
 * `enabled` flips off whenever the shelf leaves the screen (Browse home),
 * so returning always refetches. `reload()` covers in-place mutations —
 * a cover pin or edit saved while the shelf stays visible — refreshing
 * silently behind the current rows instead of flashing a loading state.
 */
export function useMyCollectionsShelf(enabled: boolean): {
  collections: CollectionSummary[] | null
  reload: () => void
} {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null)
  const [epoch, setEpoch] = useState(0)
  const wasEnabled = useRef(false)
  const reload = useCallback(() => setEpoch((e) => e + 1), [])

  useEffect(() => {
    if (!enabled) {
      wasEnabled.current = false
      return
    }
    let cancelled = false
    // A fresh enable cycle returns to loading rather than briefly showing an
    // old shelf; epoch-bump reloads keep the stale rows until the fetch lands.
    if (!wasEnabled.current) setCollections(null)
    wasEnabled.current = true
    fetchCollections({ mine: true, limit: 8 })
      .then((rows) => {
        if (!cancelled) setCollections(rows.map(apiCollectionSummaryToSummary))
      })
      .catch(() => {
        if (!cancelled) setCollections([])
      })
    return () => {
      cancelled = true
    }
  }, [enabled, epoch])

  return { collections: enabled ? collections : null, reload }
}
