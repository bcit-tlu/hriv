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
  fetchCollectionsPaged,
  fetchCollectionOwners,
  moveCollection,
  replaceCollectionImages,
  replaceCollectionOwners,
  saveCollectionViewport,
  transferCollection,
  updateCollection,
  userMessage,
  type ApiImage,
  type ApiCollectionType,
  type CollectionFilters,
} from './api'
import {
  apiCollectionOwnerToOwner,
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
  apiImageToItem,
  describeCollectionOwners,
} from './collectionUtils'
import { loadStoredRowsPerPage, ROWS_PER_PAGE_OPTIONS } from './useRowsPerPagePreference'
import type { CollectionFormValues } from './components/CollectionEditDialog'
import type {
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  User,
} from './types'
import { useBackgroundRefresh } from './useBackgroundRefresh'

/** Owner facet of the Collections list filter bar. */
export type CollectionOwnerFilter = 'any' | 'orphaned' | CollectionOwner

/**
 * Sort keys the Collections table/page can request (#1631) — the table's
 * column set minus `programs`/`groups`, which have no server-side key.
 */
export type CollectionSortKey =
  | 'id'
  | 'name'
  | 'type'
  | 'scope'
  | 'description'
  | 'category'
  | 'images'
  | 'owner'
  | 'visibility'
  | 'created'
  | 'updated'

export interface CollectionSort {
  key: CollectionSortKey
  direction: 'asc' | 'desc'
}

/** UI sort key → `GET /api/collections?sort=` value (#1631). */
export const COLLECTION_SORT_API_KEYS: Record<CollectionSortKey, string> = {
  id: 'id',
  name: 'name',
  type: 'type',
  scope: 'visibility',
  description: 'description',
  category: 'category',
  images: 'image_count',
  owner: 'owner',
  visibility: 'hidden',
  created: 'created_at',
  updated: 'updated_at',
}

/** IDs, counts and timestamps open descending; text columns open ascending. */
export function collectionSortDefaultDirection(key: CollectionSortKey): 'asc' | 'desc' {
  return key === 'id' || key === 'images' || key === 'created' || key === 'updated' ? 'desc' : 'asc'
}

export interface CollectionListFilters {
  type: CollectionType | 'all'
  mine: boolean
  owner: CollectionOwnerFilter
  /** Server-side search text (#1631) — also the graph's highlight term. */
  q: string
  /** Server-side visibility facet; kept sorted for stable cache keys. */
  visibility: CollectionVisibility[]
  /** Server-side category facet (ancestor-aware on the server). */
  categoryIds: number[]
}

export const DEFAULT_COLLECTION_FILTERS: CollectionListFilters = {
  type: 'all',
  mine: false,
  owner: 'any',
  q: '',
  visibility: [],
  categoryIds: [],
}

export const COLLECTION_NOT_FOUND_MESSAGE =
  'This collection could not be found. It may have been deleted or you may not have access to it.'

const EMPTY_ROWS = Object.freeze([]) as unknown as CollectionSummary[]
const MAX_CACHED_COLLECTION_FILTERS = 8

/** Per-request-key cache entry: the page rows plus the matching X-Total-Count. */
interface CachedCollectionRows {
  rows: CollectionSummary[]
  total: number
}

function cacheRows(
  cache: Record<string, CachedCollectionRows>,
  key: string,
  entry: CachedCollectionRows,
): Record<string, CachedCollectionRows> {
  const next = { ...cache, [key]: entry }
  while (Object.keys(next).length > MAX_CACHED_COLLECTION_FILTERS) {
    delete next[Object.keys(next)[0]]
  }
  return next
}

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

/**
 * Translate UI filters into API query params. In `'paged'` list mode the
 * search/visibility/category facets and the sort/page controls ride along
 * (#1631); in `'full'` mode (the Graph view's full-set fetch) the request
 * carries only type/mine/owner, exactly like the pre-#1631 callers.
 */
export function toCollectionApiFilters(
  filters: CollectionListFilters,
  user: Pick<User, 'role'> | null,
  options?: {
    listMode?: 'paged' | 'full'
    sort?: CollectionSortKey
    direction?: 'asc' | 'desc'
    /** 0-based UI page — sent to the server as `page + 1`. */
    page?: number
    pageSize?: number
  },
): CollectionFilters {
  const { type, mine, owner } = normalizeCollectionFilters(filters, user)
  const api: CollectionFilters = {}
  if (type !== 'all') api.type = type
  if (mine) api.mine = true
  else if (owner === 'orphaned') api.orphaned = true
  else if (owner !== 'any') {
    if (owner.kind === 'user') api.owner_user_id = owner.userId
    else api.owner_program_id = owner.programId
  }
  if (options?.listMode === 'paged') {
    const q = filters.q.trim()
    if (q) api.q = q
    if (filters.visibility.length > 0) api.visibility = [...filters.visibility].sort()
    if (filters.categoryIds.length > 0)
      api.category_ids = [...filters.categoryIds].sort((a, b) => a - b)
    const sortKey = options.sort ?? 'updated'
    api.sort = COLLECTION_SORT_API_KEYS[sortKey]
    api.direction = options.direction ?? collectionSortDefaultDirection(sortKey)
    api.page = (options.page ?? 0) + 1
    if (options.pageSize != null) api.page_size = options.pageSize
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
  // Curatorial hide rides the same PATCH (#1566) — the dialog's title link
  // only changes `hidden` for callers the `canHide` gate allows.
  if (values.hidden !== baseline.hidden) patch.hidden = values.hidden
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
  // q/visibility are the server-side facets (#1631). Category is NOT
  // mirrored: the server filter is ancestor-aware and this mirror has no
  // category tree, so checking `row.categoryId` would wrongly reject rows
  // filed into a descendant of a selected category — the follow-up reload
  // reconciles category membership.
  const q = filters.q.trim().toLowerCase()
  if (
    q !== '' &&
    !`${row.name} ${row.description ?? ''} ${describeCollectionOwners(row.owners)}`
      .toLowerCase()
      .includes(q)
  )
    return false
  if (filters.visibility.length > 0 && !filters.visibility.includes(row.visibility)) return false
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

export interface UseCollectionsDataOptions {
  /** Only fetch while the Collections tab is active. */
  enabled: boolean
  currentUser: User | null
  /** Collection open in the detail placeholder (from `?collection={id}` or a card). */
  selectedCollectionId: number | null
  /**
   * Type-filter seed (#1629): `?type=` deep links and popstate updates feed
   * the shared Type chip filter through here. The filter state owns `type`
   * afterwards — `setFilters` can change it freely.
   */
  type: CollectionType | 'all'
  /**
   * Seed version: popstate can restore the same `type` value twice (or a
   * `?type=`-less entry while the param is already `all`), so App bumps this
   * on every popstate to force the seed to re-apply.
   */
  typeSeedNonce?: number
  refreshToken: number
  backgroundRefresh: boolean
  /**
   * `'paged'` (Cards/Table) requests one page of rows per key with the
   * search/visibility/category facets and sort attached; `'full'` (Graph)
   * requests the whole visible set with only type/mine/owner (#1631).
   */
  listMode?: 'paged' | 'full'
}

export function useCollectionsData({
  enabled,
  currentUser,
  selectedCollectionId,
  type,
  typeSeedNonce = 0,
  refreshToken,
  backgroundRefresh,
  listMode = 'paged',
}: UseCollectionsDataOptions) {
  const [collectionsByKey, setCollectionsByKey] = useState<Record<string, CachedCollectionRows>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Filters are scoped to the signed-in user so one user's owner selection
  // never carries over to whoever signs in next on the same tab.
  const userId = currentUser?.id ?? null
  const [filterState, setFilterState] = useState<{
    userId: number | null
    filters: CollectionListFilters
  }>({ userId, filters: { ...DEFAULT_COLLECTION_FILTERS, type } })
  // Stable fallback so a user switch does not produce a fresh filters object
  // (and therefore a fresh `load`) on every render.
  const seededDefaults = useMemo(() => ({ ...DEFAULT_COLLECTION_FILTERS, type }), [type])
  const rawFilters = filterState.userId === userId ? filterState.filters : seededDefaults
  const setFilters = useCallback(
    (next: CollectionListFilters) => setFilterState({ userId, filters: next }),
    [userId],
  )
  // The `type` option is a URL-driven seed (#1629): when it changes (deep
  // link load, popstate restore) it lands in the filter state; afterwards
  // the Type chips own it through `setFilters`. A user switch resets the
  // state to the seeded defaults rather than carrying the old user's over.
  // `typeSeedNonce` re-applies the seed on every popstate even when `type`
  // itself did not change (e.g. Back to a `?type=`-less collections URL).
  // Render-phase adjustment (React's "you might not need an effect" pattern):
  // setState during render is the sanctioned way to react to seed changes.
  const [seedApplied, setSeedApplied] = useState({ type, nonce: typeSeedNonce, userId })
  if (
    seedApplied.userId !== userId ||
    seedApplied.nonce !== typeSeedNonce ||
    seedApplied.type !== type
  ) {
    setSeedApplied({ type, nonce: typeSeedNonce, userId })
    // Reuse `seededDefaults` so the rawFilters fallback and the stored
    // state share one identity — a fresh object here would rebuild `load`
    // and trigger a redundant second fetch for the new user.
    if (seedApplied.userId !== userId) {
      setFilterState({ userId, filters: seededDefaults })
    } else {
      setFilterState((prev) =>
        prev.filters.type === type ? prev : { userId, filters: { ...prev.filters, type } },
      )
    }
  }
  const [ownerOptions, setOwnerOptions] = useState<CollectionOwner[]>([])
  // Sort/page/page-size live outside `filters` on purpose (#1631): Clear all
  // must not reset them; each resets the page to 0 via `pageScope` below.
  const [sort, setSort] = useState<CollectionSort>({ key: 'updated', direction: 'desc' })
  const [page, setPage] = useState(0)
  // Same storage key `useRowsPerPagePreference('collections')` writes — the
  // two consumers share the per-user rows-per-page preference (#1631).
  const pageSizeKey = `hrivpref:rows-per-page:collections:user:${userId ?? 'anonymous'}`
  const [pageSizeState, setPageSizeState] = useState(() => ({
    key: pageSizeKey,
    value: loadStoredRowsPerPage(pageSizeKey, 25),
  }))
  if (pageSizeState.key !== pageSizeKey) {
    setPageSizeState({ key: pageSizeKey, value: loadStoredRowsPerPage(pageSizeKey, 25) })
  }
  const pageSize = pageSizeState.value
  const setPageSize = useCallback(
    (next: number) => {
      if (!(ROWS_PER_PAGE_OPTIONS as readonly number[]).includes(next)) return
      try {
        localStorage.setItem(pageSizeKey, String(next))
      } catch {
        // Ignore localStorage write failures and fall back to in-memory state.
      }
      setPageSizeState({ key: pageSizeKey, value: next })
    },
    [pageSizeKey],
  )
  const [detail, setDetail] = useState<Collection | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailRef = useRef<Collection | null>(null)
  useEffect(() => {
    detailRef.current = detail
  }, [detail])
  const loadSeq = useRef(0)
  const foregroundLoadInFlight = useRef<number | null>(null)
  const invalidateRef = useRef<(() => void) | null>(null)
  const lastForegroundEffectRun = useRef<{
    enabled: boolean
    userId: number | null
    load: typeof load
    refreshToken: number
  } | null>(null)
  // The user whose rows are in `collections`; another account starts empty
  // even if its own first load fails.
  const rowsUserId = useRef(userId)
  const [rowsCacheUserId, setRowsCacheUserId] = useState(userId)
  // Last X-Total-Count seen for the current scope; keeps the pagination
  // footer from collapsing while an uncached page key is still loading.
  const [lastTotal, setLastTotal] = useState(0)
  const role = currentUser?.role ?? null
  const filters = useMemo(
    () => normalizeCollectionFilters(rawFilters, role ? { role } : null),
    [rawFilters, role],
  )
  // Changing any of these scopes the list back to page 1 — page itself is
  // intentionally absent so `setPage` only moves the page (#1631).
  const pageScope = `${JSON.stringify(filters)}|${sort.key}|${sort.direction}|${listMode}|${userId}|${pageSize}`
  const [pageScopeApplied, setPageScopeApplied] = useState(pageScope)
  if (pageScopeApplied !== pageScope) {
    setPageScopeApplied(pageScope)
    if (page !== 0) setPage(0)
  }
  const apiFilters = useMemo(
    () =>
      toCollectionApiFilters(
        filters,
        role ? { role } : null,
        listMode === 'paged'
          ? {
              listMode,
              sort: sort.key,
              direction: sort.direction,
              page,
              pageSize,
            }
          : { listMode },
      ),
    [filters, role, listMode, sort, page, pageSize],
  )
  const currentKey = useMemo(() => JSON.stringify(apiFilters), [apiFilters])
  // Owner facet options come from GET /collections/owners now that the list
  // is paged (#1631) — students have no facet and skip the endpoint.
  const ownersType: ApiCollectionType | undefined =
    filters.type === 'all' ? undefined : filters.type

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    foregroundLoadInFlight.current = seq
    invalidateRef.current?.()
    if (rowsUserId.current !== userId) {
      rowsUserId.current = userId
      setCollectionsByKey({})
      setRowsCacheUserId(userId)
      setOwnerOptions([])
      setLastTotal(0)
    }
    setLoading(true)
    setError(null)
    try {
      let rows: CollectionSummary[]
      let total: number
      if (listMode === 'paged') {
        const res = await fetchCollectionsPaged(apiFilters)
        rows = res.items.map(apiCollectionSummaryToSummary)
        total = res.total
      } else {
        rows = (await fetchCollections(apiFilters)).map(apiCollectionSummaryToSummary)
        total = rows.length
      }
      if (seq !== loadSeq.current) return
      setCollectionsByKey((prev) => cacheRows(prev, currentKey, { rows, total }))
      setLastTotal(total)
      // Rows deleted under us left this page empty — step back to the last
      // page that can still hold rows; the key change triggers the reload.
      if (listMode === 'paged' && rows.length === 0 && total > 0 && page > 0) {
        setPage(Math.ceil(total / pageSize) - 1)
      }
      if (role !== 'student') {
        void fetchCollectionOwners(ownersType)
          .then((owners) => {
            if (seq !== loadSeq.current) return
            setOwnerOptions(
              owners.map(apiCollectionOwnerToOwner).filter((o): o is CollectionOwner => o != null),
            )
          })
          .catch(() => {})
      }
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(userMessage(err, 'Failed to load collections.'))
    } finally {
      if (seq === loadSeq.current) {
        foregroundLoadInFlight.current = null
        setLoading(false)
      }
    }
  }, [apiFilters, currentKey, listMode, page, pageSize, ownersType, role, userId])

  // Mutations read the filters, user and loader in effect when the request
  // completes, not those captured when it started, so a save that outlives a
  // filter change is placed and refreshed against the current view.
  const latest = useRef({
    filters,
    currentUser,
    load,
    key: currentKey,
    apiFilters,
    listMode,
    page,
    pageSize,
  })
  useEffect(() => {
    latest.current = {
      filters,
      currentUser,
      load,
      key: currentKey,
      apiFilters,
      listMode,
      page,
      pageSize,
    }
  }, [filters, currentUser, load, currentKey, apiFilters, listMode, page, pageSize])

  const writeCurrentRows = useCallback(
    (updater: (rows: CollectionSummary[]) => CollectionSummary[]) => {
      invalidateRef.current?.()
      const { key } = latest.current
      setCollectionsByKey((prev) =>
        key in prev ? { [key]: { ...prev[key], rows: updater(prev[key].rows) } } : {},
      )
    },
    [],
  )

  /**
   * Slot a freshly saved row into the current rows (#1631). `full` mode
   * holds the whole visible set, so a matching row is prepended (deduped)
   * and a non-matching one dropped. `paged` mode holds one server-sorted
   * page: an on-page row updates in place or leaves the page when it no
   * longer matches, but an off-page row is never prepended — prepending
   * would break the server ordering, and the follow-up reload places it.
   */
  const placeRow = useCallback(
    (prev: CollectionSummary[], row: CollectionSummary): CollectionSummary[] => {
      const { filters: f, currentUser: u, listMode: mode } = latest.current
      const matches = matchesCollectionFilters(row, f, u)
      if (mode === 'paged') {
        const idx = prev.findIndex((c) => c.id === row.id)
        if (idx < 0) return prev
        if (!matches) return prev.filter((c) => c.id !== row.id)
        const next = prev.slice()
        next[idx] = row
        return next
      }
      const rest = prev.filter((c) => c.id !== row.id)
      return matches ? [row, ...rest] : rest
    },
    [],
  )

  const pollRows = useCallback(async (signal: AbortSignal) => {
    const {
      currentUser: user,
      key,
      apiFilters: currentApiFilters,
      listMode: mode,
      page: currentPage,
      pageSize: currentPageSize,
    } = latest.current
    if (signal.aborted || foregroundLoadInFlight.current !== null || user == null) return
    const seq = loadSeq.current
    try {
      let rows: CollectionSummary[]
      let total: number
      if (mode === 'paged') {
        const res = await fetchCollectionsPaged(currentApiFilters, { signal })
        rows = res.items.map(apiCollectionSummaryToSummary)
        total = res.total
      } else {
        rows = (await fetchCollections(currentApiFilters, { signal })).map(
          apiCollectionSummaryToSummary,
        )
        total = rows.length
      }
      if (
        signal.aborted ||
        foregroundLoadInFlight.current !== null ||
        seq !== loadSeq.current ||
        latest.current.key !== key
      ) {
        return
      }
      setCollectionsByKey((prev) => cacheRows(prev, key, { rows, total }))
      setLastTotal(total)
      if (mode === 'paged' && rows.length === 0 && total > 0 && currentPage > 0) {
        setPage(Math.ceil(total / currentPageSize) - 1)
      }
      if (user.role !== 'student') {
        const ownerType: ApiCollectionType | undefined =
          latest.current.filters.type === 'all' ? undefined : latest.current.filters.type
        void fetchCollectionOwners(ownerType, { signal })
          .then((owners) => {
            if (signal.aborted || seq !== loadSeq.current || latest.current.key !== key) return
            setOwnerOptions(
              owners.map(apiCollectionOwnerToOwner).filter((o): o is CollectionOwner => o != null),
            )
          })
          .catch(() => {})
      }
    } catch {
      // Background failures preserve the rows and foreground error state.
    }
  }, [])

  const invalidateBackground = useBackgroundRefresh(
    pollRows,
    enabled && currentUser != null && backgroundRefresh,
  )
  useEffect(() => {
    invalidateRef.current = invalidateBackground
  }, [invalidateBackground])

  useEffect(() => {
    // Replayed effects with identical inputs (for example, StrictMode) must not duplicate list requests.
    const previous = lastForegroundEffectRun.current
    lastForegroundEffectRun.current = {
      enabled,
      userId: currentUser?.id ?? null,
      load,
      refreshToken,
    }
    if (!enabled || !currentUser) return
    if (
      previous?.enabled === enabled &&
      previous.userId === (currentUser?.id ?? null) &&
      previous.load === load &&
      previous.refreshToken === refreshToken
    ) {
      return
    }
    void load()
  }, [enabled, currentUser, load, refreshToken])

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

  const loadCollection = useCallback(async (id: number): Promise<Collection> => {
    const mapped = apiCollectionToCollection(await fetchCollection(id))
    // Keep the open detail in sync when the refetch is for the record on
    // screen — e.g. a category filing mutates the record without going
    // through `update` (#1567). The version guard keeps a slow refetch from
    // regressing a newer write that landed in the meantime.
    setDetail((prev) => (prev && prev.id === id && mapped.version >= prev.version ? mapped : prev))
    return mapped
  }, [])

  const create = useCallback(
    async (values: CollectionFormValues): Promise<Collection> => {
      const created = apiCollectionToCollection(
        await createCollection({
          name: values.name,
          description: values.description,
          type: values.type,
          visibility: values.visibility,
          ...(values.categoryId != null ? { category_id: values.categoryId } : {}),
          image_ids: [],
          ...(values.visibility === 'restricted'
            ? { program_ids: values.programIds, group_ids: values.groupIds }
            : {}),
        }),
      )
      // Reflect the server's response immediately; the refresh below only
      // reconciles with other users' changes and must not make a successful
      // save look like a failure if it happens to fail.
      writeCurrentRows((prev) => placeRow(prev, created))
      void latest.current.load()
      return created
    },
    [writeCurrentRows, placeRow],
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
      writeCurrentRows((prev) => placeRow(prev, mapped))
      void latest.current.load()
      return mapped
    },
    [writeCurrentRows, placeRow],
  )

  const remove = useCallback(
    async (id: number): Promise<void> => {
      await deleteCollection(id)
      writeCurrentRows((prev) => prev.filter((c) => c.id !== id))
      setDetail((prev) => (prev?.id === id ? null : prev))
      void latest.current.load()
    },
    [writeCurrentRows],
  )

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
  const reorderImages = useCallback(
    (id: number, imageIds: number[]): Promise<Collection> => {
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
          writeCurrentRows((prev) => placeRow(prev, updated))
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
    },
    [writeCurrentRows, placeRow],
  )

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
        writeCurrentRows((prev) => placeRow(prev, updated))
        return updated
      }
      const queued = mutationQueue.current.then(run, () => run(null))
      mutationQueue.current = queued.then(
        (updated) => updated,
        () => null,
      )
      return queued
    },
    [writeCurrentRows, placeRow],
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
  const transfer = useCallback(
    (id: number, programId: number | null): Promise<Collection> => {
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
          writeCurrentRows((prev) => placeRow(prev, updated))
          void latest.current.load()
          return updated
        } catch (err) {
          // A 409 carries the authoritative record — merge it so the next
          // attempt sends the fresh version instead of failing again.
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            writeCurrentRows((prev) => placeRow(prev, current))
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
    [writeCurrentRows, placeRow],
  )

  /**
   * Replace the whole user-owner set (#1531) via `PUT …/owners`. Same queue
   * and conflict-merge conventions as `transfer` — the two endpoints race
   * the same `version`, so a save posted behind a transfer must not send a
   * token the transfer has already consumed.
   */
  const saveOwners = useCallback(
    (id: number, userIds: number[]): Promise<Collection> => {
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
          writeCurrentRows((prev) => placeRow(prev, updated))
          void latest.current.load()
          return updated
        } catch (err) {
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            writeCurrentRows((prev) => placeRow(prev, current))
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
    [writeCurrentRows, placeRow],
  )

  /**
   * File a collection into a Browse category (#1527/#1529). Serialized with
   * reorder/viewport saves through `mutationQueue` because it carries the
   * same `version` — a move posted while a viewer write is in flight would
   * otherwise 409 on the version that write is about to consume. When the
   * queue carries a fresher record than the one the dialog captured, its
   * version wins. The `POST …/move` response is the fresh detail record, so
   * an open detail and the list row update in place. On a 409 the conflict's
   * authoritative record is merged (as in `transfer`) so a retry posts the
   * fresh version instead of failing again. A reload follows the write
   * (#1631): the server-side category facet is ancestor-aware and the local
   * mirror cannot decide whether a moved row still belongs on the page.
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
          writeCurrentRows((prev) => placeRow(prev, updated))
          void latest.current.load()
          return updated
        } catch (err) {
          // A 409 carries the authoritative record — merge it so the next
          // attempt sends the fresh version instead of failing again.
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            writeCurrentRows((prev) => placeRow(prev, current))
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
    [writeCurrentRows, placeRow],
  )

  /**
   * Curatorial hide/show (#1559): PATCHes `hidden` through the same OCC
   * `version` gate as other writes — queued with reorder/viewport saves and
   * merged-on-409 like `move`/`transfer` so a toggle posted while a viewer
   * write is in flight doesn't lose to it. `canHide`-gated (admin /
   * instructor); owners cannot unhide their own collections server-side.
   */
  const setHidden = useCallback(
    (id: number, hidden: boolean): Promise<Collection> => {
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
          writeCurrentRows((prev) => placeRow(prev, updated))
          void latest.current.load()
          return updated
        } catch (err) {
          // A 409 carries the authoritative record — merge it so a retry
          // posts the fresh version instead of failing again.
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            writeCurrentRows((prev) => placeRow(prev, current))
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
    [writeCurrentRows, placeRow],
  )

  /**
   * Pin a member image as the tile cover (`null` restores the first-member
   * fallback) — the tile's cover-picker save. Serialized with the other
   * versioned writes through `mutationQueue` and merged-on-409 like
   * `setHidden`; `canEdit`-gated like the other content fields.
   */
  const setCoverImage = useCallback(
    (id: number, imageId: number | null, blank = false): Promise<Collection> => {
      const run = async (prior: Collection | null): Promise<Collection> => {
        let baseline = baselineFor(id, prior)
        if (!baseline || baseline.id !== id) {
          baseline = apiCollectionToCollection(await fetchCollection(id))
        }
        try {
          const updated = apiCollectionToCollection(
            await updateCollection(id, {
              cover_image_id: imageId,
              cover_blank: blank,
              version: baseline.version,
            }),
          )
          setDetail((prev) => (prev?.id === id ? updated : prev))
          writeCurrentRows((prev) => placeRow(prev, updated))
          void latest.current.load()
          return updated
        } catch (err) {
          // A 409 carries the authoritative record — merge it so a retry
          // posts the fresh version instead of failing again.
          const conflict = collectionConflictCurrent(err)
          if (conflict) {
            const current = apiCollectionToCollection(conflict)
            setDetail((prev) => (prev?.id === id ? current : prev))
            writeCurrentRows((prev) => placeRow(prev, current))
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
    [writeCurrentRows, placeRow],
  )

  /**
   * Merge an authoritative collection record into the open detail and the
   * Collections-page list row (`matchesCollectionFilters` decides list
   * membership, as in `move`). No list reload: the response record is
   * already authoritative for the fields membership changes touch.
   */
  const mergeUpdated = useCallback(
    (updated: Collection) => {
      setDetail((prev) => (prev?.id === updated.id ? updated : prev))
      writeCurrentRows((prev) => placeRow(prev, updated))
    },
    [writeCurrentRows, placeRow],
  )

  /**
   * Add member images to a collection — the Browse drop-add gesture (#1530).
   * `addImagesToCollection` fetches the current record itself, so running it
   * inside `mutationQueue` means its fetch post-dates any queued write and
   * the PUT always carries a fresh `version`. The returned record (fresh on
   * every status, even `already`/`full`) is merged into detail/list state.
   */
  const addImages = useCallback(
    (id: number, imageIds: number[], requestRole = role): Promise<AddToCollectionResult> => {
      const run = async (): Promise<AddToCollectionResult> => {
        const result = await addImagesToCollection(id, imageIds, requestRole)
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
    [mergeUpdated, role],
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

  const entry = rowsCacheUserId === userId ? collectionsByKey[currentKey] : undefined
  const collections = entry?.rows ?? EMPTY_ROWS
  const total = entry?.total ?? lastTotal

  return {
    collections,
    total,
    loading,
    error,
    filters,
    setFilters,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    listMode,
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
    setCoverImage,
    addImages,
    removeImages,
    renewCollectionImage,
  }
}
