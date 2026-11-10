import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_REACTIONS,
  audienceChips,
  kindMeta,
  kindsForRole,
  reactionGlyph,
  sortAnnouncements,
} from '../src/announcementKinds'
import { makeAnnouncement } from './announcementFixtures'

describe('announcementKinds', () => {
  it('defines the controlled kind set with admin-only release and warning', () => {
    expect(ANNOUNCEMENT_KINDS.map((k) => k.kind)).toEqual([
      'notice',
      'event',
      'reminder',
      'celebration',
      'release',
      'warning',
    ])
    expect(ANNOUNCEMENT_KINDS.filter((k) => k.adminOnly).map((k) => k.kind)).toEqual([
      'release',
      'warning',
    ])
    expect(kindMeta('warning').severity).toBe('warning')
    expect(kindMeta('celebration').severity).toBe('success')
  })

  it('hides admin-only kinds from instructors', () => {
    expect(kindsForRole(false).map((k) => k.kind)).toEqual([
      'notice',
      'event',
      'reminder',
      'celebration',
    ])
    expect(kindsForRole(true)).toHaveLength(ANNOUNCEMENT_KINDS.length)
  })

  it('falls back to notice for an unknown kind', () => {
    expect(kindMeta('bogus').kind).toBe('notice')
  })

  it('exposes the eight allowed reactions with glyphs', () => {
    expect(ANNOUNCEMENT_REACTIONS.map((r) => r.id)).toEqual([
      '+1',
      'heart',
      'laugh',
      'confused',
      'hooray',
      'rocket',
      'eyes',
      'clap',
    ])
    expect(reactionGlyph('heart')).not.toBe('heart')
    expect(reactionGlyph('unknown')).toBe('unknown')
  })

  it('builds audience chips from the audience and target names', () => {
    expect(audienceChips(makeAnnouncement({ audience: 'everyone' }))).toEqual(['Everyone'])
    expect(audienceChips(makeAnnouncement({ audience: 'staff' }))).toEqual(['Staff'])
    expect(
      audienceChips(makeAnnouncement({ program_names: ['Histotech'], group_names: ['Cohort A'] })),
    ).toEqual(['Histotech', 'Cohort A'])
  })

  it('sorts pinned first, then newest notified', () => {
    const rows = [
      makeAnnouncement({ id: 1, notified_at: '2026-03-01T00:00:00+00:00' }),
      makeAnnouncement({ id: 2, notified_at: '2026-03-03T00:00:00+00:00' }),
      makeAnnouncement({ id: 3, pinned: true, notified_at: '2026-02-01T00:00:00+00:00' }),
    ]
    expect(sortAnnouncements(rows).map((a) => a.id)).toEqual([3, 2, 1])
    expect(rows.map((a) => a.id)).toEqual([1, 2, 3])
  })
})
