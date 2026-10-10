import { useEffect, useMemo, useRef, useState } from 'react'
import { getStoredUserScope } from './userScope'

function loadStoredExpanded(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

export function useImageInfoExpandedPreference() {
  const userScope = useMemo(() => getStoredUserScope(), [])
  const storageKey = `hrivpref:image-info-expanded:user:${userScope}`
  const [expanded, setExpanded] = useState(() => loadStoredExpanded(storageKey))
  const hasMountedRef = useRef(false)

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    try {
      localStorage.setItem(storageKey, expanded ? '1' : '0')
    } catch {
      // Ignore localStorage write failures and fall back to in-memory state.
    }
  }, [expanded, storageKey])

  return [expanded, setExpanded] as const
}
