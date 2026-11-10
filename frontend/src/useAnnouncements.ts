import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addAnnouncementReaction,
  fetchAnnouncements,
  markAnnouncementSeen,
  removeAnnouncementReaction,
  userMessage,
  type ApiAnnouncement,
} from './api'
import { sortAnnouncements } from './announcementKinds'
import { useBackgroundRefresh } from './useBackgroundRefresh'

export interface UseAnnouncementsResult {
  /** Inbox posts, pinned first then newest; never removed by reading. */
  announcements: ApiAnnouncement[]
  unseenCount: number
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** Idempotent per `(id, notified_at)`: a re-notified post is marked again. */
  markSeen: (announcement: ApiAnnouncement) => void
  upsert: (announcement: ApiAnnouncement) => void
  remove: (id: number) => void
  /** Optimistic toggle with rollback on failure. */
  toggleReaction: (announcement: ApiAnnouncement, emoji: string) => Promise<void>
}

export function applyReactionToggle(a: ApiAnnouncement, emoji: string): ApiAnnouncement {
  const has = a.my_reactions.includes(emoji)
  const count = (a.reactions[emoji] ?? 0) + (has ? -1 : 1)
  const reactions = { ...a.reactions }
  if (count > 0) reactions[emoji] = count
  else delete reactions[emoji]
  return {
    ...a,
    reactions,
    my_reactions: has ? a.my_reactions.filter((r) => r !== emoji) : [...a.my_reactions, emoji],
  }
}

/**
 * One shared inbox feed for the bell badge and the Announcements page (#1837).
 * Refetches on tab focus / a 30 s interval while `enabled`.
 */
export function useAnnouncements(enabled: boolean): UseAnnouncementsResult {
  const [announcements, setAnnouncements] = useState<ApiAnnouncement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seenKeysRef = useRef<Set<string>>(new Set())
  // Bumped whenever the feed is reset (logout) so in-flight callbacks from the old account are ignored.
  const generationRef = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await fetchAnnouncements('inbox')
      if (signal?.aborted) return
      // A fresh fetch is the retry point for seen writes that failed earlier.
      for (const row of rows)
        if (!row.seen) seenKeysRef.current.delete(`${row.id}:${row.notified_at ?? ''}`)
      setAnnouncements(sortAnnouncements(rows))
      setError(null)
    } catch (err) {
      if (signal?.aborted) return
      setError(userMessage(err, 'Could not load announcements'))
    } finally {
      if (!signal?.aborted) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Logged out / flag off: never keep another account's feed in memory.
      seenKeysRef.current.clear()
      generationRef.current += 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset of externally-owned data
      setAnnouncements([])
      setLoaded(false)
      setError(null)
      return
    }
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [enabled, load])

  useBackgroundRefresh(load, enabled)

  const reload = useCallback(() => load(), [load])

  const upsert = useCallback((announcement: ApiAnnouncement) => {
    setAnnouncements((prev) => {
      const next = prev.some((a) => a.id === announcement.id)
        ? prev.map((a) => (a.id === announcement.id ? announcement : a))
        : [...prev, announcement]
      return sortAnnouncements(next)
    })
  }, [])

  const remove = useCallback((id: number) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const markSeen = useCallback((announcement: ApiAnnouncement) => {
    if (announcement.seen) return
    const key = `${announcement.id}:${announcement.notified_at ?? ''}`
    if (seenKeysRef.current.has(key)) return
    seenKeysRef.current.add(key)
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === announcement.id ? { ...a, seen: true } : a)),
    )
    const generation = generationRef.current
    markAnnouncementSeen(announcement.id).catch(() => {
      // Best effort: roll back so the badge stays honest. The key stays so the Inbox effect does
      // not loop; the next successful fetch clears it and retries. Ignore callbacks from a feed
      // that has since been reset for another account.
      if (generation !== generationRef.current) return
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === announcement.id ? { ...a, seen: false } : a)),
      )
    })
  }, [])

  const toggleReaction = useCallback(async (announcement: ApiAnnouncement, emoji: string) => {
    const had = announcement.my_reactions.includes(emoji)
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === announcement.id ? applyReactionToggle(a, emoji) : a)),
    )
    try {
      const result = had
        ? await removeAnnouncementReaction(announcement.id, emoji)
        : await addAnnouncementReaction(announcement.id, emoji)
      setAnnouncements((prev) =>
        prev.map((a) =>
          a.id === announcement.id
            ? { ...a, reactions: result.reactions, my_reactions: result.my_reactions }
            : a,
        ),
      )
    } catch {
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === announcement.id ? applyReactionToggle(a, emoji) : a)),
      )
    }
  }, [])

  const unseenCount = announcements.filter((a) => !a.seen && a.status === 'live').length

  return {
    announcements,
    unseenCount,
    loading: enabled && !loaded,
    error,
    reload,
    markSeen,
    upsert,
    remove,
    toggleReaction,
  }
}
