import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { getStoredUserScope } from './userScope'

export const ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50] as const

function loadStoredRowsPerPage(storageKey: string, defaultRowsPerPage: number): number {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === null) return defaultRowsPerPage
    const parsed = Number.parseInt(stored, 10)
    return (ROWS_PER_PAGE_OPTIONS as readonly number[]).includes(parsed)
      ? parsed
      : defaultRowsPerPage
  } catch {
    return defaultRowsPerPage
  }
}

export function useRowsPerPagePreference(tableKey: string, defaultRowsPerPage = 25) {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:rows-per-page:${tableKey}:user:${userScope}`
  const [rowsPerPage, setRowsPerPageState] = useState(() =>
    loadStoredRowsPerPage(storageKey, defaultRowsPerPage),
  )

  const setRowsPerPage = useCallback<Dispatch<SetStateAction<number>>>(
    (action) => {
      setRowsPerPageState((prev) => {
        const value = typeof action === 'function' ? action(prev) : action
        try {
          localStorage.setItem(storageKey, String(value))
        } catch {
          // Ignore localStorage write failures and fall back to in-memory state.
        }
        return value
      })
    },
    [storageKey],
  )

  return [rowsPerPage, setRowsPerPage] as const
}
