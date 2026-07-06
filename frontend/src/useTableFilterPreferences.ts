import { useEffect, useMemo, useRef } from 'react'
import { getStoredUserScope } from './userScope'

interface UseTableFilterPreferencesArgs<T> {
  tableKey: string
  value: T
}

export function loadStoredTableFilters<T>(tableKey: string): T | null {
  const storageKey = `hrivpref:table-filters:${tableKey}:user:${getStoredUserScope()}`

  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return null
    return JSON.parse(stored) as T
  } catch {
    return null
  }
}

export function useTableFilterPreferences<T>({
  tableKey,
  value,
}: UseTableFilterPreferencesArgs<T>) {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:table-filters:${tableKey}:user:${userScope}`
  const serializedValue = useMemo(() => JSON.stringify(value), [value])
  const hasMountedRef = useRef(false)

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }

    try {
      localStorage.setItem(storageKey, serializedValue)
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [serializedValue, storageKey])
}
