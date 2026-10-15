import { useEffect, useState } from 'react'
import { fetchFeatures } from './api'
import { DEFAULT_FEATURES, type Features } from './types'

/**
 * Deployment feature flags (`GET /api/features`), fetched once per mount.
 *
 * Returns `null` until the response arrives so callers can distinguish
 * "unknown" from "off". A failed request resolves to `DEFAULT_FEATURES`
 * (everything off): a flaky backend must never reveal a dark-launched
 * surface. The backend enforces each flag independently (docs/collections.md).
 */
export function useFeatures(): Features | null {
  const [features, setFeatures] = useState<Features | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchFeatures()
      .then((data) => {
        if (!cancelled)
          setFeatures({
            collections: data.collections === true,
            collectionsHomeShelf: data.collections === true && data.collections_home_shelf === true,
          })
      })
      .catch(() => {
        if (!cancelled) setFeatures(DEFAULT_FEATURES)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return features
}
