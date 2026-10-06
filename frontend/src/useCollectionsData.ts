import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addImagesToCollection, removeImagesFromCollection } from './useAddToCollection'
import type { AddToCollectionResult } from './useAddToCollection'
import {
  ApiError,
  createCollection,
  deleteCollection,
  fetchCollection,
  collectionConflictCurrent,
  fetchCollections,
  moveCollection,
  replaceCollectionImages,
  replaceCollectionOwners,
  saveCollectionViewport,
  transferCollection,
  updateCollection,
  userMessage,
  type ApiImage,
  type CollectionFilters,
} from './api'
import {
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
  apiImageToItem,
} from './collectionUtils'
import type { CollectionFormValues } from './components/CollectionEditDialog'
import type { Collection, CollectionOwner, CollectionSummary, CollectionType, User } from './types'

/** Owner facet of the Collections list filter bar. */
export type CollectionOwnerFilter = 'any' | 'orphaned' | CollectionOwner

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
 * Drop owner facets the role cannot use: students have no owner facet at all
 * and `orphaned` is admin-only on the server (403 otherwise). Applied to the
 * hook's filter state so the UI, the API params and the client-side mirror
 * agree even when a selection outlives a user switch.
 */
export function normalizeCollectionFilters(
  filters: CollectionListFilters,
  user: Pick<User, 'role'> | null,
): CollectionListFilters {
  if (filters.owner === 'any') return filters
  if (user?.role === 'student' || (filters.owner === 'orphaned' && user?.role !== 'admin')) {
    return { ...filters, owner: 'any' }
  }
  return filters
}

/** Translate UI filters into API query params. */
export function toCollectionApiFilters(
  filters: CollectionListFilters,
  user: Pick<User, 'role'> | null,
): CollectionFilters {
  const { type, mine, owner } = normalizeCollectionFilters(filters, user)
  const api: CollectionFilters = {}
  if (type !== 'all') api.type = type
  if (mine) {
    api.mine = true
    return api
  }
  if (owner === 'orphaned') api.orphaned = true
  else if (owner !== 'any') {
    if (owner.kind === 'user') api.owner_user_id = owner.userId
    else api.owner_program_id = owner.programId
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
  // Owner filters match membership in the co-owner set (#1531); orphaned
  // means no user owners and no program owner (an empty owners list).
  if (filters.mine) return row.owners.some((o) => o.kind === 'user' && o.userId === user?.id)
  if (filters.owner === 'any') return true
  if (filters.owner === 'orphaned') return row.owners.length === 0
  const owner = filters.owner
  if (owner.kind === 'user')
    return row.owners.some((o) => o.kind === 'user' && o.userId === owner.userId)
  return row.owners.some((o) => o.kind === 'program' && o.programId === owner.programId)
}

function uniqueOwners(collections: CollectionSummary[]): CollectionOwner[] {
  const seen = new Set<string>()
  const owners: CollectionOwner[] = []
  for (const c of collections) {
    for (const owner of c.owners) {
      const key = owner.kind === 'user' ? `u${owner.userId}` : `p${owner.programId}`
      if (seen.has(key)) continue
      seen.add(key)
      owners.push(owner)
    }
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
  // Filters are scoped to the signed-in user so one user's owner selection
  // never carries over to whoever signs in next on the same tab.
  const userId = currentUser?.id ?? null
  const [filterState, setFilterState] = useState<{
    userId: number | null
    filters: CollectionListFilters
  }>({ userId, filters: DEFAULT_COLLECTION_FILTERS })
  const rawFilters =
    filterState.userId === userId ? filterState.filters : DEFAULT_COLLECTION_FILTERS
  const setFilters = useCallback(
    (next: CollectionListFilters) => setFilterState({ userId, filters: next }),
    [userId],
  )
  const [ownerOptions, setOwnerOptions] = useState<CollectionOwner[]>([])
  const [detail, setDetail] = useState<Collection | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailRef = useRef<Collection | null>(null)
  useEffect(() => {
    detailRef.current = detail
  }, [detail])
  const loadSeq = useRef(0)
  // The user whose rows are in `collections`; another account starts empty
  // even if its own first load fails.
  const rowsUserId = useRef(userId)
  const role = currentUser?.role ?? null
  const filters = useMemo(
    () => normalizeCollectionFilters(rawFilters, role ? { role } : null),
    [rawFilters, role],
  )

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    if (rowsUserId.current !== userId) {
      rowsUserId.current = userId
      setCollections([])
      setOwnerOptions([])
    }
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
  }, [filters, role, userId])

  // Mutations read the filters, user and loader in effect when the request
  // completes, not those captured when it started, so a save that outlives a
  // filter change is placed and refreshed against the current view.
  const latest = useRef({ filters, currentUser, load })
  useEffect(() => {
    latest.current = { filters, currentUser, load }
  }, [filters, currentUser, load])

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

  const create = useCallback(async (values: CollectionFormValues): Promise<Collection> => {
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
    const { filters: current, currentUser: user, load: refresh } = latest.current
    if (matchesCollectionFilters(created, current, user)) {
      setCollections((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
    }
    void refresh()
    return created
  }, [])

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
      const { filters: current, currentUser: user, load: refresh } = latest.current
      setCollections((prev) => {
        const rest = prev.filter((c) => c.id !== id)
        return matchesCollectionFilters(mapped, current, user) ? [mapped, ...rest] : rest
      })
      void refresh()
      return mapped
    },
    [],
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    await deleteCollection(id)
    setCollections((prev) => prev.filter((c) => c.id !== id))
    setDetail((prev) => (prev?.id === id ? null : prev))
    void latest.current.load()
  }, [])

  /**
   * Reorder the open collection's images (#1416 sequence viewer). Applies the
   * new order optimistically to `detail`, persists with the whole-replace
   * `PUT …/images` carrying the loaded `version`, and rolls `detail` back on
   * error so the caller can surface the message. Members the caller cannot
   * see are kept at the end (the backend carries them over, matching the
   * visible-only submit list).
   *
   * Drops are serialized through `mutationQueue`: each call runs only after
   * the previous PUT settles, and the queue carries the last authoritative
   * record forward so each PUT sends a `version` the server accepts even if
   * React has not committed the previous response yet. Without this, two
   * drags landing inside one PUT window send the same version — the loser
   * would 409 and roll the detail back over the winner's saved order.
   * `saveViewport` shares the queue because it bumps the same `version`.
   */
  const mutationQueue = useRef<Promise<Collection | null>>(Promise.resolve(null))
  /**
   * Pick the freshest known record for `id` between the queue-carried `prior`
   * (covers the pre-commit window after a queued mutation) and `detailRef`
   * (covers writes outside the queue like `update` or a refetch). Version
   * only ever increments, so the higher one is authoritative.
   */
  const baselineFor = (id: number, prior: Collection | null): Collection | null => {
    const detail = detailRef.current?.id === id ? detailRef.current : null
    const queued = prior?.id === id ? prior : null
    if (detail == null) return queued
    if (queued == null) return detail
    return queued.version > detail.version ? queued : detail
  }
  const reorderImages = useCallback((id: number, imageIds: number[]): Promise<Collection> => {
    const run = async (prior: Collection | null): Promise<Collection> => {
      const baseline = baselineFor(id, prior)
      if (!baseline || baseline.id !== id) {
        throw new Error('The collection is not loaded.')
      }
      const byId = new Map(baseline.images.map((img) => [img.id, img] as const))
      const optimisticImages = [
        ...imageIds
          .map((imageId) => byId.get(imageId))
          .filter((img): img is NonNullable<typeof img> => img != null),
        ...baseline.images.filter((img) => !imageIds.includes(img.id)),
      ]
      // Only paint the optimistic order when this collection is still open —
      // a queued drop can run after the user opened another collection, and
      // must not overwrite its detail (the PUT still persists the reorder).
      setDetail((prev) => (prev?.id === id ? { ...baseline, images: optimisticImages } : prev))
      try {
        const updated = apiCollectionToCollection(
          await replaceCollectionImages(id, {
            image_ids: imageIds,
            version: baseline.version,
          }),
        )
        setDetail((prev) => (prev?.id === id ? updated : prev))
        setCollections((prev) => {
          const rest = prev.filter((c) => c.id !== id)
          return matchesCollectionFilters(
            updated,
            latest.current.filters,
            latest.current.currentUser,
          )
            ? [updated, ...rest]
            : rest
        })
        void latest.current.load()
        return updated
      } catch (err) {
        setDetail((prev) => (prev?.id === id ? baseline : prev))
        throw err
      }
    }
    const queued = mutationQueue.current.then(run, () => run(null))
    // The chain never rejects — the next drop always gets a baseline.
    mutationQueue.current = queued.then(
      (updated) => updated,
      () => null,
    )
    return queued
  }, [])

  /**
   * Persist the synchronized viewer's saved positions (#1417) via the
   * whole-replace `PUT …/viewport`, updating the open detail on success.
   * Serialized with `reorderImages` through `mutationQueue` so a viewport
   * save cannot send a version an in-flight reorder has already consumed.
   */
  const saveViewport = useCallback(
    (id: number, viewportState: Record<string, unknown>): Promise<Collection> => {
      const run = async (prior: Collection | null): Promise<Collection> => {
        const baseline = baselineFor(id, prior)
        if (!baseline || baseline.id !== id) {
          throw new Error('The collection is not loaded.')
        }
        const updated = apiCollectionToCollection(
          await saveCollectionViewport(id, {
            viewport_state: viewportState,
            version: baseline.version,
          }),
        )
        setDetail((prev) => (prev?.id === id ? updated : prev))
        setCollections((prev) => {
          const rest = prev.filter((c) => c.id !== id)
          return matchesCollectionFilters(
            updated,
            latest.current.filters,
            latest.current.currentUser,
          )
            ? [updated, ...rest]
            : rest
        })
        return updated
      }
      const queued = mutationQueue.current.then(run, () => run(null))
      mutationQueue.current = queued.then(
        (updated) => updated,
        () => null,
      )
      return queued
    },
    [],
  )

  /**
   * Reassign *program* ownership (#1531) via `POST …/transfer` —
   * `programId` sets the owning program (the API clears the user-owner rows)
   * and `null` clears it, leaving the user owners in place. Serialized with
   * reorder/viewport saves through `mutationQueue` because it carries the
   * same `version`. When the target collection is not the open detail (e.g.
   * an admin reassigning an orphan from the card list), the freshest record
   * is fetched for its version before posting. A transferred collection can
   * leave the visible list (transferred away under `mine`, or assigned out
   * of `orphaned`) — `matchesCollectionFilters` decides list membership.
   */
  const transfer = useCallback((id: number, programId: number | null): Promise<Collection> => {
    const run = async (prior: Collection | null): Promise<Collection> => {
      let baseline = baselineFor(id, prior)
      if (!baseline || baseline.id !== id) {
        baseline = apiCollectionToCollection(await fetchCollection(id))
      }
      try {
        const updated = apiCollectionToCollection(
          await transferCollection(id, {
            program_id: programId,
            version: baseline.version,
          }),
        )
        setDetail((prev) => (prev?.id === id ? updated : prev))
        setCollections((prev) => {
          const rest = prev.filter((c) => c.id !== id)
          return matchesCollectionFilters(
            updated,
            latest.current.filters,
            latest.current.currentUser,
          )
            ? [updated, ...rest]
            : rest
        })
        void latest.current.load()
        return updated
      } catch (err) {
        // A 409 carries the authoritative record — merge it so the next
        // attempt sends the fresh version instead of failing again.
        const conflict = collectionConflictCurrent(err)
        if (conflict) {
          const current = apiCollectionToCollection(conflict)
          setDetail((prev) => (prev?.id === id ? current : prev))
          setCollections((prev) => {
            const rest = prev.filter((c) => c.id !== id)
            return matchesCollectionFilters(
              current,
              latest.current.filters,
              latest.current.currentUser,
            )
              ? [current, ...rest]
              : rest
          })
        }
        throw err
      }
    }
    const queued = mutationQueue.current.then(run, () => run(null))
    mutationQueue.current = queued.then(
      (updated) => updated,
      () => null,
    )
    return queued
  }, [])

  /**
   * Replace the whole user-owner set (#1531) via `PUT …/owners`. Same queue
   * and conflict-merge conventions as `transfer` — the two endpoints race
   * the same `version`, so a save posted behind a transfer must not send a
   * token the transfer has already consumed.
   */
  const saveOwners = useCallback((id: number, userIds: number[]): Promise<Collection> => {
    const run = async (prior: Collection | null): Promise<Collection> => {
      let baseline = baselineFor(id, prior)
      if (!baseline || baseline.id !== id) {
        baseline = apiCollectionToCollection(await fetchCollection(id))
      }
      try {
        const updated = apiCollectionToCollection(
          await replaceCollectionOwners(id, {
            user_ids: userIds,
            version: baseline.version,
          }),
        )
        setDetail((prev) => (prev?.id === id ? updated : prev))
        setCollections((prev) => {
          const rest = prev.filter((c) => c.id !== id)
          return matchesCollectionFilters(
            updated,
            latest.current.filters,
            latest.current.currentUser,
          )
            ? [updated, ...rest]
            : rest
        })
        void latest.current.load()
        return updated
      } catch (err) {
        const conflict = collectionConflictCurrent(err)
        if (conflict) {
          const current = apiCollectionToCollection(conflict)
          setDetail((prev) => (prev?.id === id ? current : prev))
          setCollections((prev) => {
            const rest = prev.filter((c) => c.id !== id)
            return matchesCollectionFilters(
              current,
              latest.current.filters,
              latest.current.currentUser,
            )
              ? [current, ...rest]
              : rest
          })
        }
        throw err
      }
    }
    const queued = mutationQueue.current.then(run, () => run(null))
    mutationQueue.current = queued.then(
      (updated) => updated,
      () => null,
    )
    return queued
  }, [])

  /**
   * File a collection into a Browse category (#1527/#1529). Serialized with
   * reorder/viewport saves through `mutationQueue` because it carries the
   * same `version` — a move posted while a viewer write is in flight would
   * otherwise 409 on the version that write is about to consume. When the
   * queue carries a fresher record than the one the dialog captured, its
   * version wins. The `POST …/move` response is the fresh detail record, so
   * an open detail and the list row update in place. On a 409 the conflict's
   * authoritative record is merged (as in `transfer`) so a retry posts the
   * fresh version instead of failing again.
   */
  const move = useCallback(
    (id: number, categoryId: number | null, version: number): Promise<Collection> => {
      const run = async (prior: Collection | null): Promise<Collection> => {
        const baseline = baselineFor(id, prior)
        const effectiveVersion = baseline && baseline.version > version ? baseline.version : version
        try {
          const updated = apiCollectionToCollection(
            await moveCollection(id, { category_id: categoryId, version: effectiveVersion }),
          )
          setDetail((prev) => (prev?.id === id ? updated : prev))
          setCollections((prev) => {
            const rest = prev.filter((c) => c.id !== id)
            return matchesCollectionFilters(
              updated,
              latest.current.filters,
              latest.current.currentUser,
            )
              ? [updated, ...rest]
              : rest
          })
          return updated
        } catch (err) {
          // A 409 carries the authoritative record — merge it so the next
          // attempt sends the fresh version instead of failing again.
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            setCollections((prev) => {
              const rest = prev.filter((c) => c.id !== id)
              return matchesCollectionFilters(
                current,
                latest.current.filters,
                latest.current.currentUser,
              )
                ? [current, ...rest]
                : rest
            })
          }
          throw err
        }
      }
      const queued = mutationQueue.current.then(run, () => run(null))
      mutationQueue.current = queued.then(
        (updated) => updated,
        () => null,
      )
      return queued
    },
    [],
  )

  /**
   * Curatorial hide/show (#1559): PATCHes `hidden` through the same OCC
   * `version` gate as other writes — queued with reorder/viewport saves and
   * merged-on-409 like `move`/`transfer` so a toggle posted while a viewer
   * write is in flight doesn't lose to it. `canHide`-gated (admin /
   * instructor); owners cannot unhide their own collections server-side.
   */
  const setHidden = useCallback((id: number, hidden: boolean): Promise<Collection> => {
    const run = async (prior: Collection | null): Promise<Collection> => {
      let baseline = baselineFor(id, prior)
      if (!baseline || baseline.id !== id) {
        baseline = apiCollectionToCollection(await fetchCollection(id))
      }
      try {
        const updated = apiCollectionToCollection(
          await updateCollection(id, { hidden, version: baseline.version }),
        )
        setDetail((prev) => (prev?.id === id ? updated : prev))
        setCollections((prev) => {
          const rest = prev.filter((c) => c.id !== id)
          return matchesCollectionFilters(
            updated,
            latest.current.filters,
            latest.current.currentUser,
          )
            ? [updated, ...rest]
            : rest
        })
        void latest.current.load()
        return updated
      } catch (err) {
        // A 409 carries the authoritative record — merge it so a retry
        // posts the fresh version instead of failing again.
        const conflict = collectionConflictCurrent(err)
        if (conflict) {
          const current = apiCollectionToCollection(conflict)
          setDetail((prev) => (prev?.id === id ? current : prev))
          setCollections((prev) => {
            const rest = prev.filter((c) => c.id !== id)
            return matchesCollectionFilters(
              current,
              latest.current.filters,
              latest.current.currentUser,
            )
              ? [current, ...rest]
              : rest
          })
        }
        throw err
      }
    }
    const queued = mutationQueue.current.then(run, () => run(null))
    mutationQueue.current = queued.then(
      (updated) => updated,
      () => null,
    )
    return queued
  }, [])

  /**
   * Merge an authoritative collection record into the open detail and the
   * Collections-page list row (`matchesCollectionFilters` decides list
   * membership, as in `move`). No list reload: the response record is
   * already authoritative for the fields membership changes touch.
   */
  const mergeUpdated = useCallback((updated: Collection) => {
    setDetail((prev) => (prev?.id === updated.id ? updated : prev))
    setCollections((prev) => {
      const rest = prev.filter((c) => c.id !== updated.id)
      return matchesCollectionFilters(updated, latest.current.filters, latest.current.currentUser)
        ? [updated, ...rest]
        : rest
    })
  }, [])

  /**
   * Add member images to a collection — the Browse drop-add gesture (#1530).
   * `addImagesToCollection` fetches the current record itself, so running it
   * inside `mutationQueue` means its fetch post-dates any queued write and
   * the PUT always carries a fresh `version`. The returned record (fresh on
   * every status, even `already`/`full`) is merged into detail/list state.
   */
  const addImages = useCallback(
    (id: number, imageIds: number[]): Promise<AddToCollectionResult> => {
      const run = async (): Promise<AddToCollectionResult> => {
        const result = await addImagesToCollection(id, imageIds)
        mergeUpdated(result.collection)
        return result
      }
      const queued = mutationQueue.current.then(run, () => run())
      mutationQueue.current = queued.then(
        (result) => result.collection,
        () => null,
      )
      return queued
    },
    [mergeUpdated],
  )

  /**
   * Remove member images — the undo path for the drop-add gesture (#1530),
   * serialized through `mutationQueue` like the other versioned writes.
   * `base` (the record returned by the mutation being undone) pins the PUT's
   * `version`, so any intervening write to the collection conflicts instead
   * of being silently overwritten.
   */
  const removeImages = useCallback(
    (id: number, imageIds: number[], base?: Collection): Promise<Collection> => {
      const run = async (): Promise<Collection> => {
        const updated = await removeImagesFromCollection(id, imageIds, base)
        mergeUpdated(updated)
        return updated
      }
      const queued = mutationQueue.current.then(run, () => run())
      mutationQueue.current = queued.then(
        (updated) => updated,
        () => null,
      )
      return queued
    },
    [mergeUpdated],
  )

  /**
   * Refresh a member's tokenized tile/thumb URLs inside the open collection
   * after the viewer's tile-token renewal (#1416), so a later remount does
   * not start from an expired source.
   */
  const renewCollectionImage = useCallback((collectionId: number, image: ApiImage) => {
    const fresh = apiImageToItem(image)
    setDetail((prev) =>
      prev?.id === collectionId
        ? { ...prev, images: prev.images.map((img) => (img.id === fresh.id ? fresh : img)) }
        : prev,
    )
  }, [])

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
    reorderImages,
    saveViewport,
    move,
    transfer,
    saveOwners,
    setHidden,
    addImages,
    removeImages,
    renewCollectionImage,
  }
}
