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

/** Media tokens are re-minted on every response; refresh the ones we keep this often. */
const TOKEN_REUSE_MS = 30 * 60_000

function sameExceptTokens(a: ApiAnnouncement, b: ApiAnnouncement): boolean {
  const strip = (row: ApiAnnouncement) => JSON.stringify({ ...row, media_tokens: null })
  return strip(a) === strip(b)
}

/**
 * Keep the previous row object (and its media tokens) for posts a poll did not change, so the
 * cards do not re-render and `<img src>` does not flip to a new token every 30 s — that reload
 * was visible as a periodic reflow. Tokens are still swapped every `TOKEN_REUSE_MS`.
 */
export function reuseUnchanged(
  prev: ApiAnnouncement[],
  next: ApiAnnouncement[],
  tokenAges: Map<number, number> = tokenAgesRef,
  now: number = Date.now(),
): ApiAnnouncement[] {
  const byId = new Map(prev.map((a) => [a.id, a]))
  return next.map((row) => {
    const old = byId.get(row.id)
    const minted = tokenAges.get(row.id)
    if (old && minted != null && now - minted < TOKEN_REUSE_MS && sameExceptTokens(old, row))
      return old
    tokenAges.set(row.id, now)
    return row
  })
}
const tokenAgesRef = new Map<number, number>()

export function applyReactionToggle(a: ApiAnnouncement, emoji: string): ApiAnnouncement {
  // One reaction per user: pressing own emoji removes it, any other emoji replaces it.
  const has = a.my_reactions.includes(emoji)
  const reactions = { ...a.reactions }
  const bump = (key: string, delta: number) => {
    const count = (reactions[key] ?? 0) + delta
    if (count > 0) reactions[key] = count
    else delete reactions[key]
  }
  for (const mine of a.my_reactions) bump(mine, -1)
  if (!has) bump(emoji, 1)
  return { ...a, reactions, my_reactions: has ? [] : [emoji] }
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
      setAnnouncements((prev) => sortAnnouncements(reuseUnchanged(prev, rows)))
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
