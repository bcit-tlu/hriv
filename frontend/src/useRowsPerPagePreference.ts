import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    loadStoredRowsPerPage(storageKey, defaultRowsPerPage),
  )
  const hasMountedRef = useRef(false)

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    try {
      localStorage.setItem(storageKey, String(rowsPerPage))
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [storageKey, rowsPerPage])

  return [rowsPerPage, setRowsPerPage] as const
}
