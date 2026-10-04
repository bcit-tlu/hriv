import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createCollection,
  fetchCollection,
  fetchCollections,
  replaceCollectionImages,
  userMessage,
} from './api'
import {
  SYNCHRONIZED_MAX_IMAGES,
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
} from './collectionUtils'
import type { CollectionFormValues } from './components/CollectionEditDialog'
import type { Collection, CollectionSummary } from './types'

export type AddToCollectionResult =
  | { status: 'added'; collection: Collection; addedCount: number }
  | { status: 'already'; collection: Collection }
  | { status: 'full'; collection: Collection }

/** Whether `imageIds` still fit in a `synchronized` collection of `currentCount` images. */
export function fitsCollectionCapacity(
  collection: Pick<CollectionSummary, 'type'>,
  currentCount: number,
  imageIds: readonly number[],
): boolean {
  return (
    collection.type !== 'synchronized' || currentCount + imageIds.length <= SYNCHRONIZED_MAX_IMAGES
  )
}

/**
 * Append `imageIds` to a collection. The member list is fetched first so the
 * whole-replace `PUT /images` never drops images added by someone else and
 * the collection's `version` is current. Already-present ids are skipped;
 * when none remain the call is a no-op (`already`).
 */
export async function addImagesToCollection(
  collectionId: number,
  imageIds: readonly number[],
): Promise<AddToCollectionResult> {
  const current = apiCollectionToCollection(await fetchCollection(collectionId))
  const existing = current.images.map((img) => img.id)
  const missing = Array.from(new Set(imageIds)).filter((id) => !existing.includes(id))
  if (missing.length === 0) return { status: 'already', collection: current }
  if (!fitsCollectionCapacity(current, existing.length, missing)) {
    return { status: 'full', collection: current }
  }
  const updated = await replaceCollectionImages(collectionId, {
    image_ids: [...existing, ...missing],
    version: current.version,
  })
  return {
    status: 'added',
    collection: apiCollectionToCollection(updated),
    addedCount: missing.length,
  }
}

/** Create a collection that starts with `imageIds` (in order, de-duplicated). */
export async function createCollectionWithImages(
  values: CollectionFormValues,
  imageIds: readonly number[],
): Promise<Collection> {
  return apiCollectionToCollection(
    await createCollection({
      name: values.name,
      description: values.description,
      type: values.type,
      visibility: values.visibility,
      image_ids: Array.from(new Set(imageIds)),
      ...(values.visibility === 'restricted'
        ? { program_ids: values.programIds, group_ids: values.groupIds }
        : {}),
    }),
  )
}

/**
 * Collections the caller may see, loaded on each `enabled` false → true
 * transition (modal open). The list endpoint is already access-filtered by
 * the backend, so no client-side visibility filtering happens here.
 */
export function useVisibleCollections(enabled: boolean) {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const rows = (await fetchCollections()).map(apiCollectionSummaryToSummary)
      if (seq !== loadSeq.current) return
      setCollections(rows)
    } catch (err) {
      if (seq !== loadSeq.current) return
      // A failed refresh must not keep serving deleted/inaccessible rows.
      setCollections([])
      setError(userMessage(err, 'Failed to load collections.'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])

  const prevEnabled = useRef(false)
  useEffect(() => {
    if (enabled && !prevEnabled.current) {
      void load()
    }
    prevEnabled.current = enabled
  }, [enabled, load])

  return { collections, loading, error, reload: load }
}

/**
 * Collections the caller may add images to (`permissions.can_edit`), loaded
 * on each `enabled` false → true transition (dialog open).
 */
export function useEditableCollections(enabled: boolean) {
  const { collections, ...rest } = useVisibleCollections(enabled)
  const editable = useMemo(() => collections.filter((c) => c.permissions.canEdit), [collections])
  return { collections: editable, ...rest }
}
