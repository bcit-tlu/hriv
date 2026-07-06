import { useEffect, useMemo, useRef } from 'react'

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

interface UseTableFilterPreferencesArgs<T> {
  tableKey: string
  value: T
  onHydrate: (value: T) => void
}

export function useTableFilterPreferences<T>({
  tableKey,
  value,
  onHydrate,
}: UseTableFilterPreferencesArgs<T>) {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:table-filters:${tableKey}:user:${userScope}`
  const serializedValue = useMemo(() => JSON.stringify(value), [value])
  const hasMountedRef = useRef(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return
      onHydrate(JSON.parse(stored) as T)
    } catch {
      // Ignore corrupt or unavailable localStorage values.
    }
  }, [onHydrate, storageKey])

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
