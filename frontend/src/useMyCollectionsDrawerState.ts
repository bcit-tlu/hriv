import { useCallback, useMemo, useState } from 'react'
import { getStoredUserScope } from './userScope'

const STORAGE_PREFIX = 'hrivpref:my-collections-drawer:pinned:user:'

function loadPinned(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

export function useMyCollectionsDrawerState() {
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${getStoredUserScope()}`, [])
  const [pinned, setPinnedState] = useState(() => loadPinned(storageKey))
  const [open, setOpen] = useState(pinned)

  const setPinned = useCallback(
    (nextPinned: boolean) => {
      setPinnedState(nextPinned)
      if (!nextPinned) setOpen(false)
      try {
        localStorage.setItem(storageKey, String(nextPinned))
      } catch {
        // Ignore localStorage write failures and keep the in-memory preference.
      }
    },
    [storageKey],
  )

  return { open, setOpen, pinned, setPinned }
}
