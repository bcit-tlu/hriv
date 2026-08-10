import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  fetchCategoryTree,
  fetchUncategorizedImages,
  fetchPrograms as apiFetchPrograms,
  fetchGroups as apiFetchGroups,
} from './api'
import type { ApiCategoryTree, ApiImage } from './api'
import type { Category, Group, ImageItem, Program, User } from './types'
import { narrowProgramIds, narrowGroupIds, resolvePathNode } from './categoryUtils'
import { apiGroupToGroup } from './groupUtils'
import { tileOrderingCoordinator } from './tileOrdering'
import { useBackgroundRefresh } from './useBackgroundRefresh'

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function apiImageToItem(img: ApiImage): ImageItem {
  return {
    id: img.id,
    name: img.name,
    thumb: img.thumb,
    tileSources: img.tile_sources,
    categoryId: img.category_id,
    copyright: img.copyright,
    note: img.note,
    active: img.active,
    sortOrder: img.sort_order,
    version: img.version,
    createdAt: img.created_at,
    updatedAt: img.updated_at,
    metadataExtra: img.metadata_extra,
    width: img.width,
    height: img.height,
    fileSize: img.file_size,
  }
}

export function apiTreeToCategory(node: ApiCategoryTree): Category {
  const meta = node.metadata_extra as Record<string, unknown> | null
  return {
    id: node.id,
    label: node.label,
    parentId: node.parent_id,
    children: node.children.map(apiTreeToCategory),
    images: node.images.map(apiImageToItem),
    programIds: node.program_ids ?? [],
    groupIds: node.group_ids ?? [],
    status: node.status,
    sortOrder: node.sort_order,
    version: node.version,
    cardImageId: typeof meta?.card_image_id === 'number' ? meta.card_image_id : null,
    metadataExtra: meta ?? null,
  }
}

export interface UseBrowseDataDeps {
  path: Category[]
  currentUser: User | null
}

export function useBrowseData({ path, currentUser }: UseBrowseDataDeps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [uncategorizedImages, setUncategorizedImages] = useState<ImageItem[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const uncategorizedLoaded = useRef(false)

  // Ref holds the invalidateBackground function once the hook mounts.
  // loadCategories reads it to cancel in-flight background requests on
  // foreground fetches without requiring every call site to change.
  const invalidateRef = useRef<(() => void) | null>(null)

  // Latest-request-wins sequencing (epic #975, issue #980): every category
  // and uncategorized-image read claims a generation, and only the newest
  // read may commit state. A slow older response (foreground or background)
  // can therefore never overwrite data from a newer one, regardless of
  // completion order. Foreground reads also abort the previous foreground
  // request for the same data.
  const categoriesReadGen = useRef(0)
  const uncategorizedReadGen = useRef(0)
  const visibleCategoriesLoadGen = useRef(0)
  const categoriesAbortRef = useRef<AbortController | null>(null)
  const uncategorizedAbortRef = useRef<AbortController | null>(null)

  // Mirror the latest committed state so a superseded (aborted) refresh can
  // resolve with the freshest data instead of rejecting.
  const categoriesRef = useRef<Category[]>([])
  const uncategorizedRef = useRef<ImageItem[]>([])
  // Newest in-flight authoritative refresh per data type: a superseded
  // refresh chains onto this so its caller receives the data the winning
  // refresh commits, not a possibly pre-mutation mirror.
  const categoriesRefreshRef = useRef<{ gen: number; promise: Promise<Category[]> } | null>(null)
  const uncategorizedRefreshRef = useRef<{ gen: number; promise: Promise<ImageItem[]> } | null>(
    null,
  )
  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])
  useEffect(() => {
    uncategorizedRef.current = uncategorizedImages
  }, [uncategorizedImages])

  // Loaders resolve `true` only when fresh data was actually applied, so
  // callers can gate cache invalidation on authoritative data having landed.
  const loadCategories = useCallback(
    async (opts?: { silent?: boolean; signal?: AbortSignal }): Promise<boolean> => {
      const { silent = false, signal } = opts ?? {}
      const gen = ++categoriesReadGen.current
      let effectiveSignal = signal
      if (!signal) {
        invalidateRef.current?.()
        categoriesAbortRef.current?.abort()
        const ac = new AbortController()
        categoriesAbortRef.current = ac
        effectiveSignal = ac.signal
      }
      const visibleGen = silent ? 0 : ++visibleCategoriesLoadGen.current
      try {
        if (!silent) setCategoriesLoading(true)
        const tree = await fetchCategoryTree(
          effectiveSignal ? { signal: effectiveSignal } : undefined,
        )
        if (effectiveSignal?.aborted || gen !== categoriesReadGen.current) return false
        setCategories(tree.map(apiTreeToCategory))
        return true
      } catch (err) {
        if (effectiveSignal?.aborted || isAbortError(err) || gen !== categoriesReadGen.current) {
          return false
        }
        console.error('Failed to load categories', err)
        return false
      } finally {
        // Only a newer visible load (which will clear the flag itself) may
        // suppress cleanup — silent reads never own the loading flag.
        if (!silent && visibleGen === visibleCategoriesLoadGen.current) setCategoriesLoading(false)
      }
    },
    [],
  )

  const loadUncategorizedImages = useCallback(
    async (opts?: { signal?: AbortSignal }): Promise<boolean> => {
      const { signal } = opts ?? {}
      const gen = ++uncategorizedReadGen.current
      let effectiveSignal = signal
      if (!signal) {
        uncategorizedAbortRef.current?.abort()
        const ac = new AbortController()
        uncategorizedAbortRef.current = ac
        effectiveSignal = ac.signal
      }
      try {
        const imgs = await fetchUncategorizedImages(
          effectiveSignal ? { signal: effectiveSignal } : undefined,
        )
        if (effectiveSignal?.aborted || gen !== uncategorizedReadGen.current) return false
        setUncategorizedImages(imgs.map(apiImageToItem))
        uncategorizedLoaded.current = true
        return true
      } catch (err) {
        if (effectiveSignal?.aborted || isAbortError(err) || gen !== uncategorizedReadGen.current) {
          return false
        }
        console.error('Failed to load uncategorized images', err)
        uncategorizedLoaded.current = true
        return false
      }
    },
    [],
  )

  const loadPrograms = useCallback(async () => {
    try {
      const p = await apiFetchPrograms()
      setPrograms(
        p.map((pg) => ({
          id: pg.id,
          name: pg.name,
          oidc_group: pg.oidc_group,
          created_at: pg.created_at,
          updated_at: pg.updated_at,
        })),
      )
    } catch {
      // Silently ignore — programs are non-critical for initial load
    }
  }, [])

  const loadGroups = useCallback(async () => {
    try {
      const g = await apiFetchGroups()
      setGroups(g.map(apiGroupToGroup))
    } catch {
      // Silently ignore — groups are non-critical for initial load
    }
  }, [])

  const refreshCategories = useCallback(async (): Promise<Category[]> => {
    invalidateRef.current?.()
    // Authoritative refresh: claim the newest generation and abort any older
    // read for the same data.
    const gen = ++categoriesReadGen.current
    categoriesAbortRef.current?.abort()
    const ac = new AbortController()
    categoriesAbortRef.current = ac
    // Force bypass the browser HTTP cache so we always get the
    // freshly-committed sort_order values after a reorder.  Without
    // this the browser may serve a stale 304-backed response whose
    // ETag was computed before the reorder transaction committed.
    const run = (async (): Promise<Category[]> => {
      try {
        const tree = await fetchCategoryTree({ cache: 'reload', signal: ac.signal })
        const cats = tree.map(apiTreeToCategory)
        if (gen === categoriesReadGen.current) setCategories(cats)
        return cats
      } catch (err) {
        if (isAbortError(err)) {
          // A newer authoritative refresh superseded this one: expected
          // control flow, not a failure — resolve with the winning
          // refresh's data so callers never receive pre-mutation state.
          const newest = categoriesRefreshRef.current
          if (newest !== null && newest.gen > gen) return newest.promise
          return categoriesRef.current
        }
        throw err
      }
    })()
    categoriesRefreshRef.current = { gen, promise: run }
    return run
  }, [])

  const refreshUncategorizedImages = useCallback(async (): Promise<ImageItem[]> => {
    const gen = ++uncategorizedReadGen.current
    uncategorizedAbortRef.current?.abort()
    const ac = new AbortController()
    uncategorizedAbortRef.current = ac
    const run = (async (): Promise<ImageItem[]> => {
      try {
        const imgs = await fetchUncategorizedImages({ cache: 'reload', signal: ac.signal })
        const items = imgs.map(apiImageToItem)
        if (gen === uncategorizedReadGen.current) {
          setUncategorizedImages(items)
          uncategorizedLoaded.current = true
        }
        return items
      } catch (err) {
        if (isAbortError(err)) {
          const newest = uncategorizedRefreshRef.current
          if (newest !== null && newest.gen > gen) return newest.promise
          return uncategorizedRef.current
        }
        throw err
      }
    })()
    uncategorizedRefreshRef.current = { gen, promise: run }
    return run
  }, [])

  // Background refresh: re-fetch categories and uncategorized images every
  // 30 s while the tab is visible.  The category tree endpoint returns
  // ETag + Cache-Control: private, no-cache so the browser's default fetch
  // cache mode transparently sends If-None-Match and receives 304 when
  // nothing changed.
  const backgroundRefresh = useCallback(
    async (signal: AbortSignal) => {
      // Pending-order protection (issue #980): never let a polling response
      // race a reorder that is dirty, saving, conflicted, or awaiting retry.
      // Polling resumes on the next tick once the coordinator is clean.
      if (tileOrderingCoordinator.hasUnsavedChanges()) return
      // Capture before fetching: a save that commits while these requests
      // are in flight is newer than the fetched data and must survive the
      // release below.
      const marker = tileOrderingCoordinator.marker()
      const categoriesFresh = await loadCategories({ silent: true, signal })
      const imagesFresh = await loadUncategorizedImages({ signal })
      // Only when fresh authoritative data actually landed may the
      // coordinator's cached display order be dropped for clean scopes —
      // a failed poll must not make a just-saved order fall back to the
      // stale pre-save tree.
      if (!signal.aborted && categoriesFresh && imagesFresh) {
        tileOrderingCoordinator.releaseCleanScopes(marker)
      }
    },
    [loadCategories, loadUncategorizedImages],
  )
  const invalidateBackground = useBackgroundRefresh(backgroundRefresh, currentUser != null)
  useEffect(() => {
    invalidateRef.current = invalidateBackground
  })

  // Resolve the live children/images from the categories state tree
  // so newly added categories appear immediately.
  const { cats: resolvedCategories, imgs: currentImages } = useMemo(
    () => resolvePathNode(categories, path),
    [categories, path],
  )

  // Walk the categories tree along the given path segments applying narrowing
  // (intersection) semantics. `depth` controls how many path segments to
  // traverse (defaults to all).
  const getPathRestriction = useCallback(
    (depth?: number): number[] => {
      const ancestors: Category[] = []
      let node = categories
      const limit = depth ?? path.length
      for (let i = 0; i < limit; i++) {
        const found = node.find((c) => c.id === path[i].id)
        if (!found) break
        ancestors.push(found)
        node = found.children
      }
      return narrowProgramIds(ancestors)
    },
    [categories, path],
  )

  const ancestorProgramIds = useMemo(() => getPathRestriction(), [getPathRestriction])

  // Group analogue of getPathRestriction: walk the path applying the same
  // ancestor-narrowing semantics to the (independent) group dimension.
  const getPathGroupRestriction = useCallback(
    (depth?: number): number[] => {
      const ancestors: Category[] = []
      let node = categories
      const limit = depth ?? path.length
      for (let i = 0; i < limit; i++) {
        const found = node.find((c) => c.id === path[i].id)
        if (!found) break
        ancestors.push(found)
        node = found.children
      }
      return narrowGroupIds(ancestors)
    },
    [categories, path],
  )

  const ancestorGroupIds = useMemo(() => getPathGroupRestriction(), [getPathGroupRestriction])

  // Filter out hidden categories for students in browse mode
  const isStudent = currentUser?.role === 'student'
  const currentCategories = useMemo(
    () =>
      isStudent ? resolvedCategories.filter((c) => c.status !== 'hidden') : resolvedCategories,
    [isStudent, resolvedCategories],
  )

  return {
    categories,
    categoriesLoading,
    setCategories,
    uncategorizedImages,
    uncategorizedLoaded,
    setUncategorizedImages,
    programs,
    groups,
    setGroups,
    loadCategories,
    loadUncategorizedImages,
    loadPrograms,
    loadGroups,
    refreshCategories,
    refreshUncategorizedImages,
    currentImages,
    getPathRestriction,
    ancestorProgramIds,
    getPathGroupRestriction,
    ancestorGroupIds,
    currentCategories,
  }
}
