import { useEffect, useState } from 'react'
import { fetchCollections } from './api'
import { apiCollectionSummaryToSummary } from './collectionUtils'
import type { CollectionSummary } from './types'

export function useMyCollectionsShelf(enabled: boolean): CollectionSummary[] | null {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null)

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
  }, [enabled])

  return enabled ? collections : null
}
