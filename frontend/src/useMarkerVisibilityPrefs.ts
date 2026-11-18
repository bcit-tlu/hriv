import { useMemo, useSyncExternalStore } from 'react'
import type { ApiMarker, MarkerSource } from './types'

export type VisibilityKind = 'markerVisible' | 'labelVisible'
type Visibility = Record<VisibilityKind, boolean>
type Override = Partial<Visibility> & { id: number; source: MarkerSource }
interface Preferences {
  groups: Record<MarkerSource, Visibility>
  items: Override[]
}
export const MAX_MARKER_VISIBILITY_ENTRIES = 500
const eventName = 'hriv:marker-visibility'
const fallback = new Map<string, string>()
const sources: MarkerSource[] = ['mine', 'instructor', 'public']
const defaults = (): Preferences => ({
  groups: {
    mine: { markerVisible: true, labelVisible: true },
    instructor: { markerVisible: true, labelVisible: true },
    public: { markerVisible: true, labelVisible: true },
  },
  items: [],
})
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function source(value: unknown): value is MarkerSource {
  return value === 'mine' || value === 'instructor' || value === 'public'
}
function parse(raw: string | null): Preferences {
  const result = defaults()
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!record(value)) return result
    for (const name of sources) {
      const group = record(value.groups) ? value.groups[name] : null
      if (!record(group)) continue
      for (const kind of ['markerVisible', 'labelVisible'] as const) {
        if (typeof group[kind] === 'boolean') result.groups[name][kind] = group[kind]
      }
    }
    if (Array.isArray(value.items)) {
      const items = new Map<number, Override>()
      for (const item of value.items.slice(-MAX_MARKER_VISIBILITY_ENTRIES)) {
        if (
          !record(item) ||
          typeof item.id !== 'number' ||
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          !source(item.source)
        )
          continue
        const entry: Override = { id: item.id, source: item.source }
        if (typeof item.markerVisible === 'boolean') entry.markerVisible = item.markerVisible
        if (typeof item.labelVisible === 'boolean') entry.labelVisible = item.labelVisible
        items.set(entry.id, entry)
      }
      result.items = [...items.values()]
    }
  } catch {
    /* Corrupt or old preferences fall back to visible markers and labels. */
  }
  return result
}
function read(key: string, persist: boolean): string | null {
  if (fallback.has(key)) return fallback.get(key) ?? null
  try {
    return persist ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}
function write(key: string, persist: boolean, value: Preferences) {
  const raw = JSON.stringify(value)
  try {
    if (persist) {
      localStorage.setItem(key, raw)
      fallback.delete(key)
    } else fallback.set(key, raw)
  } catch {
    fallback.set(key, raw)
  }
  window.dispatchEvent(new Event(eventName))
}

export function useMarkerVisibilityPrefs(userId?: number, enabled = true) {
  const key = `hriv.markerVisibility.${userId ?? 'session'}`
  const persist = userId != null
  const raw = useSyncExternalStore(
    (notify) => {
      if (!enabled) return () => {}
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          fallback.delete(key)
          notify()
        }
      }
      window.addEventListener(eventName, notify)
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener(eventName, notify)
        window.removeEventListener('storage', onStorage)
      }
    },
    () => (enabled ? read(key, persist) : null),
    () => null,
  )
  const prefs = useMemo(() => parse(raw), [raw])
  const visibilityFor = (item: Pick<ApiMarker, 'id' | 'source'>): Visibility => {
    const group = item.source
      ? prefs.groups[item.source]
      : { markerVisible: true, labelVisible: true }
    const override = prefs.items.find(
      (entry) => entry.id === item.id && entry.source === item.source,
    )
    return {
      markerVisible: override?.markerVisible ?? group.markerVisible,
      labelVisible: override?.labelVisible ?? group.labelVisible,
    }
  }
  return {
    groups: prefs.groups,
    visibilityFor,
    setGroup(name: MarkerSource, kind: VisibilityKind, visible: boolean) {
      if (!enabled) return
      const next = parse(read(key, persist))
      next.groups[name][kind] = visible
      for (const item of next.items) if (item.source === name) delete item[kind]
      next.items = next.items.filter(
        (item) => item.markerVisible !== undefined || item.labelVisible !== undefined,
      )
      write(key, persist, next)
    },
    setItem(item: Pick<ApiMarker, 'id' | 'source'>, kind: VisibilityKind, visible: boolean) {
      if (!enabled || !item.source) return
      const next = parse(read(key, persist))
      const existing = next.items.find(
        (entry) => entry.id === item.id && entry.source === item.source,
      )
      next.items = next.items.filter((entry) => entry.id !== item.id)
      next.items.push({ ...existing, id: item.id, source: item.source, [kind]: visible })
      next.items = next.items.slice(-MAX_MARKER_VISIBILITY_ENTRIES)
      write(key, persist, next)
    },
  }
}
export type MarkerVisibilityPrefs = ReturnType<typeof useMarkerVisibilityPrefs>
