import { describe, expect, it } from 'vitest'
import { firstLine, selectBannerAnnouncements, selectNotices } from '../src/announcementUtils'
import { makeAnnouncement } from './announcementFixtures'

describe('selectBannerAnnouncements', () => {
  it('keeps only live, unseen, banner-flagged posts', () => {
    const rows = [
      makeAnnouncement({ id: 1, banner: true }),
      makeAnnouncement({ id: 2, banner: false }),
      makeAnnouncement({ id: 3, banner: true, seen: true }),
      makeAnnouncement({ id: 4, banner: true, status: 'scheduled' }),
      makeAnnouncement({ id: 5, banner: true, status: 'expired' }),
    ]
    expect(selectBannerAnnouncements(rows).map((a) => a.id)).toEqual([1])
  })

  it('orders warnings first, then pinned, then newest', () => {
    const rows = [
      makeAnnouncement({ id: 1, banner: true, notified_at: '2026-03-01T00:00:00+00:00' }),
      makeAnnouncement({
        id: 2,
        banner: true,
        pinned: true,
        notified_at: '2026-01-01T00:00:00+00:00',
      }),
      makeAnnouncement({
        id: 3,
        banner: true,
        kind: 'warning',
        notified_at: '2025-01-01T00:00:00+00:00',
      }),
      makeAnnouncement({ id: 4, banner: true, notified_at: '2026-04-01T00:00:00+00:00' }),
    ]
    expect(selectBannerAnnouncements(rows).map((a) => a.id)).toEqual([3, 2, 4, 1])
  })
})

describe('selectNotices', () => {
  it('returns at most three pinned live posts in feed order', () => {
    const rows = [1, 2, 3, 4].map((id) => makeAnnouncement({ id, pinned: true }))
    rows.push(
      makeAnnouncement({ id: 9, pinned: false }),
      makeAnnouncement({ id: 10, pinned: true, status: 'expired' }),
    )
    expect(selectNotices(rows).map((a) => a.id)).toEqual([1, 2, 3])
    expect(selectNotices([])).toEqual([])
  })
})

describe('firstLine', () => {
  it('strips headings, list markers, inline markup and skips media-only lines', () => {
    expect(firstLine('# Welcome **all**\nmore')).toBe('Welcome all')
    expect(firstLine('\n- First *item* with [a link](https://x)\n- second')).toBe(
      'First item with a link',
    )
    expect(firstLine('![slide](/api/media/1)\n/api/media/2\nActual text')).toBe('Actual text')
    expect(firstLine('')).toBe('')
  })
})
