import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStoredUserScope } from './userScope'

type ColumnVisibilityMap<Key extends string> = Record<Key, boolean>

interface UseTableColumnPreferencesArgs<Key extends string> {
  tableKey: string
  allColumns: readonly Key[]
  defaultVisibleColumns: readonly Key[]
}

function buildDefaultVisibility<Key extends string>(
  allColumns: readonly Key[],
  defaultVisibleColumns: readonly Key[],
): ColumnVisibilityMap<Key> {
  return Object.fromEntries(
    allColumns.map((column) => [column, defaultVisibleColumns.includes(column)]),
  ) as ColumnVisibilityMap<Key>
}

function loadStoredVisibility<Key extends string>(
  storageKey: string,
  allColumns: readonly Key[],
  defaultVisibility: ColumnVisibilityMap<Key>,
): ColumnVisibilityMap<Key> {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return defaultVisibility
    const parsed = JSON.parse(stored) as Partial<Record<Key, unknown>>
    return Object.fromEntries(
      allColumns.map((column) => [
        column,
        typeof parsed[column] === 'boolean'
          ? (parsed[column] as boolean)
          : defaultVisibility[column],
      ]),
    ) as ColumnVisibilityMap<Key>
  } catch {
    return defaultVisibility
  }
}

function areVisibilityMapsEqual<Key extends string>(
  left: ColumnVisibilityMap<Key>,
  right: ColumnVisibilityMap<Key>,
  allColumns: readonly Key[],
): boolean {
  return allColumns.every((column) => left[column] === right[column])
}

/**
 * Reconcile a (possibly stale or hand-edited) stored order with the column
 * keys the table actually ships: stored keys keep their order, unknown keys
 * are dropped, and columns absent from storage are appended in `allColumns`
 * order so a newly added column appears at the end rather than vanishing.
 */
function normalizeColumnOrder<Key extends string>(
  stored: readonly unknown[],
  allColumns: readonly Key[],
): Key[] {
  const known = new Set<string>(allColumns)
  const seen = new Set<Key>()
  const order: Key[] = []
  for (const entry of stored) {
    if (typeof entry !== 'string' || !known.has(entry)) continue
    const key = entry as Key
    if (seen.has(key)) continue
    seen.add(key)
    order.push(key)
  }
  for (const column of allColumns) {
    if (!seen.has(column)) order.push(column)
  }
  return order
}

function loadStoredOrder<Key extends string>(
  storageKey: string,
  allColumns: readonly Key[],
): Key[] {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return [...allColumns]
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return [...allColumns]
    return normalizeColumnOrder(parsed, allColumns)
  } catch {
    return [...allColumns]
  }
}

export function useTableColumnPreferences<Key extends string>({
  tableKey,
  allColumns,
  defaultVisibleColumns,
}: UseTableColumnPreferencesArgs<Key>) {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:table-columns:${tableKey}:user:${userScope}`
  const orderStorageKey = `hrivpref:table-column-order:${tableKey}:user:${userScope}`
  const defaultVisibility = useMemo(
    () => buildDefaultVisibility(allColumns, defaultVisibleColumns),
    [allColumns, defaultVisibleColumns],
  )
  const loadedVisibility = useMemo(
    () => loadStoredVisibility(storageKey, allColumns, defaultVisibility),
    [storageKey, allColumns, defaultVisibility],
  )
  const loadedVisibilitySerialized = useMemo(
    () => JSON.stringify(loadedVisibility),
    [loadedVisibility],
  )
  const [visibleColumns, setVisibleColumns] = useState<ColumnVisibilityMap<Key>>(loadedVisibility)
  const hasMountedRef = useRef(false)
  const pendingHydrationRef = useRef<{ storageKey: string; serialized: string } | null>({
    storageKey,
    serialized: loadedVisibilitySerialized,
  })

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }

    pendingHydrationRef.current = {
      storageKey,
      serialized: loadedVisibilitySerialized,
    }
    setVisibleColumns((prev) =>
      areVisibilityMapsEqual(prev, loadedVisibility, allColumns) ? prev : loadedVisibility,
    )
  }, [allColumns, loadedVisibility, loadedVisibilitySerialized, storageKey])

  useEffect(() => {
    const serialized = JSON.stringify(visibleColumns)
    const pendingHydration = pendingHydrationRef.current
    if (pendingHydration?.storageKey === storageKey) {
      if (pendingHydration.serialized !== serialized) return
      pendingHydrationRef.current = null
      return
    }

    try {
      localStorage.setItem(storageKey, serialized)
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [storageKey, visibleColumns])

  // ── Column order (issue #1577) ────────────────────────────────────────
  // Order persists under a separate key so existing visibility blobs are
  // untouched; the reconciliation mirrors the visibility hydration pattern.
  const loadedOrder = useMemo(
    () => loadStoredOrder(orderStorageKey, allColumns),
    [orderStorageKey, allColumns],
  )
  const loadedOrderSerialized = useMemo(() => JSON.stringify(loadedOrder), [loadedOrder])
  const [columnOrder, setColumnOrderState] = useState<Key[]>(loadedOrder)
  const orderHasMountedRef = useRef(false)
  const pendingOrderHydrationRef = useRef<{ storageKey: string; serialized: string } | null>({
    storageKey: orderStorageKey,
    serialized: loadedOrderSerialized,
  })

  useEffect(() => {
    if (!orderHasMountedRef.current) {
      orderHasMountedRef.current = true
      return
    }

    pendingOrderHydrationRef.current = {
      storageKey: orderStorageKey,
      serialized: loadedOrderSerialized,
    }
    setColumnOrderState((prev) =>
      prev.length === loadedOrder.length && prev.every((c, i) => c === loadedOrder[i])
        ? prev
        : loadedOrder,
    )
  }, [allColumns, loadedOrder, loadedOrderSerialized, orderStorageKey])

  useEffect(() => {
    const serialized = JSON.stringify(columnOrder)
    const pendingHydration = pendingOrderHydrationRef.current
    if (pendingHydration?.storageKey === orderStorageKey) {
      if (pendingHydration.serialized !== serialized) return
      pendingOrderHydrationRef.current = null
      return
    }

    try {
      localStorage.setItem(orderStorageKey, serialized)
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [orderStorageKey, columnOrder])

  const isColumnVisible = useCallback((column: Key) => visibleColumns[column], [visibleColumns])

  const setColumnVisible = useCallback((column: Key, visible: boolean) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: visible }))
  }, [])

  const toggleColumn = useCallback((column: Key) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: !prev[column] }))
  }, [])

  /**
   * Replace the column order (e.g. after a drag reorder). Unknown keys are
   * dropped and any columns missing from *order* are appended in
   * `allColumns` order — same reconciliation as the stored-order loader.
   */
  const setColumnOrder = useCallback(
    (order: readonly Key[]) => {
      setColumnOrderState(normalizeColumnOrder(order, allColumns))
    },
    [allColumns],
  )

  const orderedVisibleColumns = useMemo(
    () => columnOrder.filter((column) => visibleColumns[column]),
    [columnOrder, visibleColumns],
  )

  return {
    visibleColumns,
    isColumnVisible,
    setColumnVisible,
    toggleColumn,
    columnOrder,
    orderedVisibleColumns,
    setColumnOrder,
  }
}
