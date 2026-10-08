import { useEffect, useState } from 'react'
import { fetchCollections } from './api'
import { apiCollectionSummaryToSummary } from './collectionUtils'
import type { CollectionSummary } from './types'

export function useMyCollectionsShelf(enabled: boolean): CollectionSummary[] | null {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // A fresh enable cycle returns to loading rather than briefly showing an old shelf.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollections(null)
    fetchCollections({ mine: true, limit: 5 })
      .then((rows) => {
        if (!cancelled) setCollections(rows.map(apiCollectionSummaryToSummary))
      })
      .catch(() => {
        if (!cancelled) setCollections([])
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return enabled ? collections : null
}
