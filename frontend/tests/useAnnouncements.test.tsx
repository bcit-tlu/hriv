import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import * as api from '../src/api'
import { applyReactionToggle, useAnnouncements } from '../src/useAnnouncements'
import { makeAnnouncement } from './announcementFixtures'

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../src/api')
  return {
    ...actual,
    fetchAnnouncements: vi.fn(),
    markAnnouncementSeen: vi.fn(),
    addAnnouncementReaction: vi.fn(),
    removeAnnouncementReaction: vi.fn(),
  }
})

const mockFetch = vi.mocked(api.fetchAnnouncements)
const mockSeen = vi.mocked(api.markAnnouncementSeen)
const mockAdd = vi.mocked(api.addAnnouncementReaction)
const mockRemove = vi.mocked(api.removeAnnouncementReaction)

describe('applyReactionToggle', () => {
  it('adds a reaction the viewer has not made and removes one they have', () => {
    const a = makeAnnouncement({ reactions: { heart: 2 }, my_reactions: ['heart'] })
    const removed = applyReactionToggle(a, 'heart')
    expect(removed.reactions).toEqual({ heart: 1 })
    expect(removed.my_reactions).toEqual([])
    const added = applyReactionToggle(removed, 'rocket')
    expect(added.reactions).toEqual({ heart: 1, rocket: 1 })
    expect(added.my_reactions).toEqual(['rocket'])
  })

  it('drops the key when the last reaction is removed', () => {
    const a = makeAnnouncement({ reactions: { eyes: 1 }, my_reactions: ['eyes'] })
    expect(applyReactionToggle(a, 'eyes').reactions).toEqual({})
  })
})

describe('useAnnouncements', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockSeen.mockReset().mockResolvedValue(undefined)
    mockAdd.mockReset()
    mockRemove.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('does nothing while disabled', () => {
    const { result } = renderHook(() => useAnnouncements(false))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.announcements).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('loads the inbox, counts unseen live posts and sorts pinned first', async () => {
    mockFetch.mockResolvedValue([
      makeAnnouncement({ id: 1, seen: true, notified_at: '2026-03-01T00:00:00+00:00' }),
      makeAnnouncement({ id: 2, pinned: true, notified_at: '2026-02-01T00:00:00+00:00' }),
      makeAnnouncement({ id: 3, notified_at: '2026-03-05T00:00:00+00:00' }),
    ])
    const { result } = renderHook(() => useAnnouncements(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).toHaveBeenCalledWith('inbox')
    expect(result.current.announcements.map((a) => a.id)).toEqual([2, 3, 1])
    expect(result.current.unseenCount).toBe(2)
  })

  it('surfaces a load error', async () => {
    mockFetch.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAnnouncements(true))
    await waitFor(() => expect(result.current.error).toBeTruthy())
  })

  it('marks a post seen once per id/notified_at', async () => {
    const a = makeAnnouncement({ id: 4 })
    mockFetch.mockResolvedValue([a])
    const { result } = renderHook(() => useAnnouncements(true))
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))
    act(() => {
      result.current.markSeen(a)
      result.current.markSeen(a)
    })
    expect(mockSeen).toHaveBeenCalledTimes(1)
    expect(result.current.announcements[0].seen).toBe(true)
    expect(result.current.unseenCount).toBe(0)
    act(() => result.current.markSeen({ ...a, notified_at: '2026-04-01T00:00:00+00:00' }))
    expect(mockSeen).toHaveBeenCalledTimes(2)
  })

  it('toggles reactions optimistically and rolls back on failure', async () => {
    const a = makeAnnouncement({ id: 5 })
    mockFetch.mockResolvedValue([a])
    mockAdd.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useAnnouncements(true))
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))
    await act(async () => {
      await result.current.toggleReaction(a, 'clap')
    })
    expect(mockAdd).toHaveBeenCalledWith(5, 'clap')
    expect(result.current.announcements[0].reactions).toEqual({})
    expect(result.current.announcements[0].my_reactions).toEqual([])
  })

  it('applies the server reaction counts after a successful toggle', async () => {
    const a = makeAnnouncement({ id: 6, reactions: { clap: 1 }, my_reactions: ['clap'] })
    mockFetch.mockResolvedValue([a])
    mockRemove.mockResolvedValue({ reactions: {}, my_reactions: [] })
    const { result } = renderHook(() => useAnnouncements(true))
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))
    await act(async () => {
      await result.current.toggleReaction(a, 'clap')
    })
    expect(mockRemove).toHaveBeenCalledWith(6, 'clap')
    expect(result.current.announcements[0].reactions).toEqual({})
  })
})
