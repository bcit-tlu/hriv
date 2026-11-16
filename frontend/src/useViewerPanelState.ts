import { useCallback, useEffect, useState } from 'react'

export type ViewerPanelTab = 'inuksuks' | 'details'
interface Preference {
  open: boolean
  tab: ViewerPanelTab
}
const defaults: Preference = { open: false, tab: 'inuksuks' }
const preferences = new Map<string, Preference>()

function load(key: string | null): Preference {
  if (!key) return defaults
  try {
    const stored = localStorage.getItem(key)
    if (stored == null) return preferences.get(key) ?? defaults
    const value = JSON.parse(stored)
    return { open: value?.open === true, tab: value?.tab === 'details' ? 'details' : 'inuksuks' }
  } catch {
    return preferences.get(key) ?? defaults
  }
}

export function useViewerPanelState(userId: number | undefined, enableStorageSync = true) {
  const key = enableStorageSync && userId != null ? `hrivpref:viewer-panel:user:${userId}` : null
  const [state, setState] = useState(() => ({ key, ...load(key) }))
  if (state.key !== key) setState({ key, ...load(key) })
  useEffect(() => {
    if (!key || key !== state.key) return
    preferences.set(key, { open: state.open, tab: state.tab })
    try {
      localStorage.setItem(key, JSON.stringify({ open: state.open, tab: state.tab }))
    } catch {
      /* Keep the in-memory preference. */
    }
  }, [key, state])
  const setOpen = useCallback((open: boolean) => setState((value) => ({ ...value, open })), [])
  const setTab = useCallback((tab: ViewerPanelTab) => setState((value) => ({ ...value, tab })), [])
  return { open: state.open, tab: state.tab, setOpen, setTab }
}
