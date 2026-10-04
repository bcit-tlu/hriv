import { describe, it, expect } from 'vitest'
import type { ApiImage } from '../src/api'
import {
  apiCollectionOwnerToOwner,
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
  apiImageToItem,
  canUseRestrictedVisibility,
  describeCollectionOwner,
  parseCollectionIdParam,
  parseCollectionItemParam,
} from '../src/collectionUtils'
import { makeApiCollection, makeApiCollectionSummary } from './helpers/fixtures'

const API_IMAGE: ApiImage = {
  id: 11,
  name: 'lateral.jpg',
  thumb: '/thumb/11.jpg?token=t',
  tile_sources: '/tiles/11.dzi?token=t',
  category_id: 4,
  copyright: '© BCIT',
  note: 'left side',
  active: true,
  sort_order: 2,
  metadata_extra: { scale: 1.5 },
  version: 3,
  width: 800,
  height: 600,
  file_size: 2048,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
}

describe('collectionUtils mapping', () => {
  it('maps a user owner, a program owner, and null', () => {
    expect(apiCollectionOwnerToOwner({ user_id: 7, name: 'Ada' })).toEqual({
      kind: 'user',
      userId: 7,
      name: 'Ada',
    })
    expect(apiCollectionOwnerToOwner({ program_id: 3, name: 'Radiography' })).toEqual({
      kind: 'program',
      programId: 3,
      name: 'Radiography',
    })
    expect(apiCollectionOwnerToOwner(null)).toBeNull()
  })

  it('maps owners as the backend serialises them, with the unused id present as null', () => {
    expect(
      apiCollectionOwnerToOwner({ user_id: null, program_id: 3, name: 'Radiography' }),
    ).toEqual({ kind: 'program', programId: 3, name: 'Radiography' })
    expect(apiCollectionOwnerToOwner({ user_id: 7, program_id: null, name: 'Ada' })).toEqual({
      kind: 'user',
      userId: 7,
      name: 'Ada',
    })
    expect(apiCollectionOwnerToOwner({ user_id: null, program_id: null, name: '' })).toBeNull()
  })

  it('maps a summary to camelCase including permissions', () => {
    const summary = apiCollectionSummaryToSummary(
      makeApiCollectionSummary({
        permissions: { can_edit: false, can_delete: true, can_transfer: true },
      }),
    )
    expect(summary).toMatchObject({
      id: 1,
      name: 'Skull comparison',
      type: 'synchronized',
      visibility: 'private',
      owner: { kind: 'user', userId: 7, name: 'Ada Lovelace' },
      imageCount: 2,
      coverThumb: '/thumbs/skull.jpg?token=abc',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      permissions: { canEdit: false, canDelete: true, canTransfer: true },
    })
  })

  it('maps ApiImage → ImageItem field by field', () => {
    expect(apiImageToItem(API_IMAGE)).toEqual({
      id: 11,
      name: 'lateral.jpg',
      thumb: '/thumb/11.jpg?token=t',
      tileSources: '/tiles/11.dzi?token=t',
      categoryId: 4,
      copyright: '© BCIT',
      note: 'left side',
      active: true,
      sortOrder: 2,
      version: 3,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
      metadataExtra: { scale: 1.5 },
      width: 800,
      height: 600,
      fileSize: 2048,
    })
  })

  it('maps a full collection, preserving member image order and scope ids', () => {
    const full = apiCollectionToCollection(
      makeApiCollection({
        images: [API_IMAGE, { ...API_IMAGE, id: 12, sort_order: 0 }],
        program_ids: [3],
        group_ids: [9, 10],
        viewport_state: { zoom: 2 },
      }),
    )
    expect(full.images.map((i) => i.id)).toEqual([11, 12])
    expect(full.programIds).toEqual([3])
    expect(full.groupIds).toEqual([9, 10])
    expect(full.viewportState).toEqual({ zoom: 2 })
  })

  it('describes owners for display', () => {
    expect(describeCollectionOwner({ kind: 'user', userId: 1, name: 'Ada' })).toBe('Ada')
    expect(describeCollectionOwner({ kind: 'program', programId: 1, name: 'Nursing' })).toBe(
      'Nursing (program)',
    )
    expect(describeCollectionOwner(null)).toBe('No owner')
  })
})

describe('canUseRestrictedVisibility', () => {
  it('allows admin and instructor only', () => {
    expect(canUseRestrictedVisibility('admin')).toBe(true)
    expect(canUseRestrictedVisibility('instructor')).toBe(true)
    expect(canUseRestrictedVisibility('staff')).toBe(false)
    expect(canUseRestrictedVisibility('student')).toBe(false)
    expect(canUseRestrictedVisibility(undefined)).toBe(false)
    expect(canUseRestrictedVisibility(null)).toBe(false)
  })
})

describe('parseCollectionIdParam', () => {
  it('parses a positive integer id', () => {
    expect(parseCollectionIdParam('?collection=12')).toBe(12)
    expect(parseCollectionIdParam('?image=3&collection=7')).toBe(7)
  })

  it('rejects missing, non-numeric, negative, zero and decimal values', () => {
    expect(parseCollectionIdParam('')).toBeNull()
    expect(parseCollectionIdParam('?page=collections')).toBeNull()
    expect(parseCollectionIdParam('?collection=abc')).toBeNull()
    expect(parseCollectionIdParam('?collection=-1')).toBeNull()
    expect(parseCollectionIdParam('?collection=0')).toBeNull()
    expect(parseCollectionIdParam('?collection=1.5')).toBeNull()
    expect(parseCollectionIdParam('?collection=')).toBeNull()
  })

  it('rejects integers that cannot be represented exactly', () => {
    expect(parseCollectionIdParam(`?collection=${Number.MAX_SAFE_INTEGER}`)).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    expect(parseCollectionIdParam('?collection=9007199254740993')).toBeNull()
    expect(parseCollectionIdParam(`?collection=${'9'.repeat(400)}`)).toBeNull()
  })
})

describe('parseCollectionItemParam', () => {
  it('parses the sequence position beside a collection id (#1416)', () => {
    expect(parseCollectionItemParam('?collection=12&item=99')).toBe(99)
    expect(parseCollectionItemParam('?item=3&collection=7')).toBe(3)
  })

  it('requires a valid ?collection= to be meaningful', () => {
    expect(parseCollectionItemParam('?item=99')).toBeNull()
    expect(parseCollectionItemParam('?collection=abc&item=99')).toBeNull()
    expect(parseCollectionItemParam('?page=collections&item=99')).toBeNull()
  })

  it('rejects missing, non-numeric, negative, zero and decimal values', () => {
    expect(parseCollectionItemParam('?collection=12')).toBeNull()
    expect(parseCollectionItemParam('?collection=12&item=')).toBeNull()
    expect(parseCollectionItemParam('?collection=12&item=abc')).toBeNull()
    expect(parseCollectionItemParam('?collection=12&item=-1')).toBeNull()
    expect(parseCollectionItemParam('?collection=12&item=0')).toBeNull()
    expect(parseCollectionItemParam('?collection=12&item=1.5')).toBeNull()
  })

  it('rejects integers that cannot be represented exactly', () => {
    expect(parseCollectionItemParam('?collection=12&item=9007199254740993')).toBeNull()
  })
})
