import { useCallback, useEffect, useState } from 'react'
import { fetchCollections } from './api'
import { apiCollectionSummaryToSummary } from './collectionUtils'
import type { CollectionSummary } from './types'

/**
 * The feed refetches whenever Browse enables it, including after returning
 * from another page. `reload()` covers in-place mutations, refreshing behind
 * the current rows so the drawer does not disappear while a request is pending.
 */
export function useMyCollectionsShelf(enabled: boolean): {
  collections: CollectionSummary[] | null
  reload: () => void
} {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null)
  const [epoch, setEpoch] = useState(0)
  const reload = useCallback(() => setEpoch((e) => e + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
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
