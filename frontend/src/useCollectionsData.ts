import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createCollection,
  deleteCollection,
  fetchCollection,
  fetchCollections,
  updateCollection,
  userMessage,
  type CollectionFilters,
} from './api'
import { apiCollectionSummaryToSummary, apiCollectionToCollection } from './collectionUtils'
import type { CollectionFormValues } from './components/CollectionEditDialog'
import type { Collection, CollectionOwner, CollectionSummary, CollectionType, User } from './types'

/** Owner facet of the Collections list filter bar. */
export type CollectionOwnerFilter = 'any' | 'orphaned' | NonNullable<CollectionOwner>

export interface CollectionListFilters {
  type: CollectionType | 'all'
  mine: boolean
  owner: CollectionOwnerFilter
}

export const DEFAULT_COLLECTION_FILTERS: CollectionListFilters = {
  type: 'all',
  mine: false,
  owner: 'any',
}

export const COLLECTION_NOT_FOUND_MESSAGE =
  'This collection could not be found. It may have been deleted or you may not have access to it.'

/**
 * Translate UI filters into API query params. `orphaned` is admin-only on the
 * server (403 otherwise) so it is dropped for every other role, and students
 * have no owner facet at all so `owner_*` is never sent for them.
 */
export function toCollectionApiFilters(
  filters: CollectionListFilters,
  user: Pick<User, 'role'> | null,
): CollectionFilters {
  const api: CollectionFilters = {}
  if (filters.type !== 'all') api.type = filters.type
  if (filters.mine) {
    api.mine = true
    return api
  }
  if (user?.role === 'student') return api
  if (filters.owner === 'orphaned') {
    if (user?.role === 'admin') api.orphaned = true
  } else if (filters.owner !== 'any') {
    if (filters.owner.kind === 'user') api.owner_user_id = filters.owner.userId
    else api.owner_program_id = filters.owner.programId
  }
  return api
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Body for `PATCH /api/collections/{id}` containing only the fields that differ
 * from `baseline` (the record the form was seeded from). Omitting unchanged
 * `visibility`/scope matters: the backend re-checks restricted authority
 * whenever those keys are present, so a metadata-only edit of a restricted
 * collection must not resend them.
 */
export function toCollectionPatch(
  values: CollectionFormValues,
  baseline: Collection | null,
  version: number,
): Parameters<typeof updateCollection>[1] {
  const restricted = values.visibility === 'restricted'
  if (!baseline) {
    return {
      name: values.name,
      description: values.description,
      visibility: values.visibility,
      ...(restricted ? { program_ids: values.programIds, group_ids: values.groupIds } : {}),
      version,
    }
  }
  const patch: Parameters<typeof updateCollection>[1] = { version }
  if (values.name !== baseline.name) patch.name = values.name
  if (values.description !== baseline.description) patch.description = values.description
  const visibilityChanged = values.visibility !== baseline.visibility
  if (visibilityChanged) patch.visibility = values.visibility
  if (
    restricted &&
    (visibilityChanged ||
      !sameIds(values.programIds, baseline.programIds) ||
      !sameIds(values.groupIds, baseline.groupIds))
  ) {
    patch.program_ids = values.programIds
    patch.group_ids = values.groupIds
  }
  return patch
}

/** Client-side mirror of the list filters, used to slot a freshly saved row into the current view. */
export function matchesCollectionFilters(
  row: CollectionSummary,
  filters: CollectionListFilters,
  user: Pick<User, 'id'> | null,
): boolean {
  if (filters.type !== 'all' && row.type !== filters.type) return false
  if (filters.mine) return row.owner?.kind === 'user' && row.owner.userId === user?.id
  if (filters.owner === 'any') return true
  if (filters.owner === 'orphaned') return row.owner == null
  const owner = filters.owner
  if (owner.kind === 'user') return row.owner?.kind === 'user' && row.owner.userId === owner.userId
  return row.owner?.kind === 'program' && row.owner.programId === owner.programId
}

function uniqueOwners(collections: CollectionSummary[]): NonNullable<CollectionOwner>[] {
  const seen = new Set<string>()
  const owners: NonNullable<CollectionOwner>[] = []
  for (const c of collections) {
    if (c.owner == null) continue
    const key = c.owner.kind === 'user' ? `u${c.owner.userId}` : `p${c.owner.programId}`
    if (seen.has(key)) continue
    seen.add(key)
    owners.push(c.owner)
  }
  return owners.sort((a, b) => a.name.localeCompare(b.name))
}

export interface UseCollectionsDataOptions {
  /** Only fetch while the Collections tab is active. */
  enabled: boolean
  currentUser: User | null
  /** Collection open in the detail placeholder (from `?collection={id}` or a card). */
  selectedCollectionId: number | null
}

export function useCollectionsData({
  enabled,
  currentUser,
  selectedCollectionId,
}: UseCollectionsDataOptions) {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CollectionListFilters>(DEFAULT_COLLECTION_FILTERS)
  const [ownerOptions, setOwnerOptions] = useState<NonNullable<CollectionOwner>[]>([])
  const [detail, setDetail] = useState<Collection | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const loadSeq = useRef(0)
  const role = currentUser?.role ?? null

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const apiFilters = toCollectionApiFilters(filters, role ? { role } : null)
      const rows = (await fetchCollections(apiFilters)).map(apiCollectionSummaryToSummary)
      if (seq !== loadSeq.current) return
      setCollections(rows)
      // Owner choices come from the unfiltered-by-owner result so the menu
      // does not collapse to the single owner currently selected.
      if (!filters.mine && filters.owner === 'any') setOwnerOptions(uniqueOwners(rows))
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(userMessage(err, 'Failed to load collections.'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [filters, role])

  useEffect(() => {
    if (!enabled || !currentUser) return
    void load() // eslint-disable-line react-hooks/set-state-in-effect -- standard data-fetch trigger on tab/filter change
  }, [enabled, currentUser, load])

  // Detail (placeholder view) — refetched whenever the selected id changes.
  useEffect(() => {
    if (!enabled || !currentUser || selectedCollectionId == null) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- early-return cleanup in conditional fetch effect */
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    setDetail((prev) => (prev?.id === selectedCollectionId ? prev : null))
    fetchCollection(selectedCollectionId)
      .then((api) => {
        if (cancelled) return
        setDetail(apiCollectionToCollection(api))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setDetail(null)
        setDetailError(
          err instanceof ApiError && err.status === 404
            ? COLLECTION_NOT_FOUND_MESSAGE
            : userMessage(err, 'Failed to load collection.'),
        )
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, currentUser, selectedCollectionId])

  const loadCollection = useCallback(
    async (id: number): Promise<Collection> => apiCollectionToCollection(await fetchCollection(id)),
    [],
  )

  const create = useCallback(
    async (values: CollectionFormValues): Promise<Collection> => {
      const created = apiCollectionToCollection(
        await createCollection({
          name: values.name,
          description: values.description,
          type: values.type,
          visibility: values.visibility,
          image_ids: [],
          ...(values.visibility === 'restricted'
            ? { program_ids: values.programIds, group_ids: values.groupIds }
            : {}),
        }),
      )
      // Reflect the server's response immediately; the refresh below only
      // reconciles with other users' changes and must not make a successful
      // save look like a failure if it happens to fail.
      if (matchesCollectionFilters(created, filters, currentUser)) {
        setCollections((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
      }
      void load()
      return created
    },
    [load, filters, currentUser],
  )

  const update = useCallback(
    async (
      id: number,
      values: CollectionFormValues,
      version: number,
      baseline: Collection | null = null,
    ): Promise<Collection> => {
      const updated = await updateCollection(id, toCollectionPatch(values, baseline, version))
      const mapped = apiCollectionToCollection(updated)
      setDetail((prev) => (prev?.id === id ? mapped : prev))
      setCollections((prev) => {
        const rest = prev.filter((c) => c.id !== id)
        return matchesCollectionFilters(mapped, filters, currentUser) ? [mapped, ...rest] : rest
      })
      void load()
      return mapped
    },
    [load, filters, currentUser],
  )

  const remove = useCallback(
    async (id: number): Promise<void> => {
      await deleteCollection(id)
      setCollections((prev) => prev.filter((c) => c.id !== id))
      setDetail((prev) => (prev?.id === id ? null : prev))
      void load()
    },
    [load],
  )

  return {
    collections,
    loading,
    error,
    filters,
    setFilters,
    ownerOptions,
    reload: load,
    detail,
    detailLoading,
    detailError,
    loadCollection,
    create,
    update,
    remove,
  }
}
