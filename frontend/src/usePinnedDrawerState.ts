import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

interface DrawerState {
  userScope: string
  pinned: boolean
  open: boolean
}

function loadPinned(userScope: string): boolean {
  try {
    return localStorage.getItem(userScope) === 'true'
  } catch {
    return false
  }
}

export function usePinnedDrawerState(user: string, drawer: string, enableStorageSync = true) {
  const userScope = `hrivpref:${drawer}:pinned:user:${user}`
  const [state, setState] = useState<DrawerState>(() => {
    const pinned = enableStorageSync && loadPinned(userScope)
    return { userScope, pinned, open: pinned }
  })

  if (state.userScope !== userScope) {
    const pinned = enableStorageSync && loadPinned(userScope)
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
        open: current.open,
      }))
      if (!enableStorageSync) return
      try {
        localStorage.setItem(userScope, String(nextPinned))
      } catch {
        // Ignore localStorage write failures and keep the in-memory preference.
      }
    },
    [userScope, enableStorageSync],
  )

  return { open: state.open, setOpen, pinned: state.pinned, setPinned }
}
