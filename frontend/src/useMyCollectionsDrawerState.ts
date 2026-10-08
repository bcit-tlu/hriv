import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

const STORAGE_PREFIX = 'hrivpref:my-collections-drawer:pinned:user:'

interface DrawerState {
  userScope: string
  pinned: boolean
  open: boolean
}

function loadPinned(userScope: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${userScope}`) === 'true'
  } catch {
    return false
  }
}

export function useMyCollectionsDrawerState(userScope: string) {
  const [state, setState] = useState<DrawerState>(() => {
    const pinned = loadPinned(userScope)
    return { userScope, pinned, open: pinned }
  })

  if (state.userScope !== userScope) {
    const pinned = loadPinned(userScope)
    setState({ userScope, pinned, open: pinned })
  }

  const setOpen = useCallback<Dispatch<SetStateAction<boolean>>>((nextOpen) => {
    setState((current) => ({
      ...current,
      open: typeof nextOpen === 'function' ? nextOpen(current.open) : nextOpen,
    }))
  }, [])

  const setPinned = useCallback(
    (nextPinned: boolean) => {
      setState((current) => ({
        ...current,
        pinned: nextPinned,
        // Unpinning must not collapse the sheet — it only hands the drawer
        // back to temporary mode (the backdrop returns); the pin is not a
        // close control.
        open: current.open,
      }))
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${userScope}`, String(nextPinned))
      } catch {
        // Ignore localStorage write failures and keep the in-memory preference.
      }
    },
    [userScope],
  )

  return { open: state.open, setOpen, pinned: state.pinned, setPinned }
}
