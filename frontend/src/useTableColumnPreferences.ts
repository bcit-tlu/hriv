import { useCallback, useEffect, useMemo, useState } from 'react'

type ColumnVisibilityMap<Key extends string> = Record<Key, boolean>

interface UseTableColumnPreferencesArgs<Key extends string> {
  tableKey: string
  allColumns: readonly Key[]
  defaultVisibleColumns: readonly Key[]
}

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

export function useTableColumnPreferences<Key extends string>({
  tableKey,
  allColumns,
  defaultVisibleColumns,
}: UseTableColumnPreferencesArgs<Key>) {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:table-columns:${tableKey}:user:${userScope}`
  const defaultVisibility = useMemo(
    () => buildDefaultVisibility(allColumns, defaultVisibleColumns),
    [allColumns, defaultVisibleColumns],
  )
  const [visibleColumns, setVisibleColumns] =
    useState<ColumnVisibilityMap<Key>>(() =>
      loadStoredVisibility(storageKey, allColumns, defaultVisibility),
    )

  useEffect(() => {
    setVisibleColumns(loadStoredVisibility(storageKey, allColumns, defaultVisibility))
  }, [allColumns, defaultVisibility, storageKey])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleColumns))
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [storageKey, visibleColumns])

  const isColumnVisible = useCallback(
    (column: Key) => visibleColumns[column],
    [visibleColumns],
  )

  const setColumnVisible = useCallback((column: Key, visible: boolean) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: visible }))
  }, [])

  const toggleColumn = useCallback((column: Key) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: !prev[column] }))
  }, [])

  return {
    visibleColumns,
    isColumnVisible,
    setColumnVisible,
    toggleColumn,
  }
}
