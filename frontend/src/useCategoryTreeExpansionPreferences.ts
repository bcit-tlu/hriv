import { useCallback, useMemo, useSyncExternalStore } from 'react'

interface CategoryTreeOption {
  id: number
  depth: number
  childCount: number
}

interface CategoryTreeExpansionSnapshot {
  userScope: string
  collapsedIds: Set<number>
}

const listeners = new Set<() => void>()
let currentSnapshot: CategoryTreeExpansionSnapshot | null = null

function getStoredUserScope(): string {
  try {
    const stored = localStorage.getItem('hriv_user')
    if (!stored) return 'anonymous'
    const parsed = JSON.parse(stored) as { id?: number | string }
    return parsed.id != null ? String(parsed.id) : 'anonymous'
  } catch {
    return 'anonymous'
  }
}

function buildStorageKey(userScope: string): string {
  return `hrivpref:category-tree-collapsed:user:${userScope}`
}

function areSetsEqual(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function loadCollapsedIds(userScope: string): Set<number> {
  try {
    const stored = localStorage.getItem(buildStorageKey(userScope))
    if (!stored) return new Set<number>()
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return new Set<number>()
    return new Set(
      parsed.filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      ),
    )
  } catch {
    return new Set<number>()
  }
}

function persistSnapshot(snapshot: CategoryTreeExpansionSnapshot): void {
  try {
    localStorage.setItem(
      buildStorageKey(snapshot.userScope),
      JSON.stringify([...snapshot.collapsedIds]),
    )
  } catch {
    // Ignore storage write failures and keep the in-memory store live.
  }
}

function getSnapshot(): CategoryTreeExpansionSnapshot {
  const userScope = getStoredUserScope()
  if (currentSnapshot?.userScope === userScope) {
    return currentSnapshot
  }

  currentSnapshot = {
    userScope,
    collapsedIds: loadCollapsedIds(userScope),
  }
  return currentSnapshot
}

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function updateCollapsedIds(updater: (previous: Set<number>) => Set<number>): void {
  const snapshot = getSnapshot()
  const nextCollapsedIds = updater(snapshot.collapsedIds)
  if (areSetsEqual(snapshot.collapsedIds, nextCollapsedIds)) return

  currentSnapshot = {
    userScope: snapshot.userScope,
    collapsedIds: nextCollapsedIds,
  }
  persistSnapshot(currentSnapshot)
  emitChange()
}

export function getCollapsedDescendantIds(
  options: CategoryTreeOption[],
  collapsedIds: Set<number>,
): Set<number> {
  const ids = new Set<number>()
  const collapsedAtDepth: boolean[] = []

  for (const opt of options) {
    collapsedAtDepth.length = opt.depth
    const hiddenByCollapsed = opt.depth > 0 ? (collapsedAtDepth[opt.depth - 1] ?? false) : false
    if (hiddenByCollapsed) ids.add(opt.id)
    collapsedAtDepth[opt.depth] = hiddenByCollapsed || collapsedIds.has(opt.id)
  }

  return ids
}

export function useCategoryTreeExpansionPreferences<Option extends CategoryTreeOption>(
  options: Option[],
) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const collapsedIds = snapshot.collapsedIds
  const collapsedDescendantIds = useMemo(
    () => getCollapsedDescendantIds(options, collapsedIds),
    [options, collapsedIds],
  )
  const visibleOptions = useMemo(
    () => options.filter((opt) => !collapsedDescendantIds.has(opt.id)),
    [options, collapsedDescendantIds],
  )

  const isExpanded = useCallback(
    (categoryId: number) => !collapsedIds.has(categoryId),
    [collapsedIds],
  )

  const toggleExpanded = useCallback((categoryId: number) => {
    updateCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }, [])

  return {
    collapsedIds,
    collapsedDescendantIds,
    visibleOptions,
    isExpanded,
    toggleExpanded,
  }
}

export function resetCategoryTreeExpansionPreferencesForTests(): void {
  currentSnapshot = null
  listeners.clear()
}
