import { describe, it, expect } from 'vitest'
import type { ApiImage } from '../src/api'
import {
  apiCollectionOwnerToOwner,
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
  apiImageToItem,
  canUseRestrictedVisibility,
  collectionFullMessage,
  collectionImageCap,
  describeCollectionOwner,
  describeCollectionOwners,
  ownedCollectionCounts,
  parseCollectionIdParam,
  parseCollectionItemParam,
  privateFilingWarning,
  studentTypesAtCap,
} from '../src/collectionUtils'
import {
  makeApiCollection,
  makeApiCollectionSummary,
  makeCollectionSummary,
} from './helpers/fixtures'

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

describe('collection capacity helpers', () => {
  it('returns role-aware image caps while keeping synchronized capped for everyone', () => {
    expect(collectionImageCap('synchronized', null)).toBe(4)
    expect(collectionImageCap('sequence', 'student')).toBe(20)
    expect(collectionImageCap('sequence', 'instructor')).toBeNull()
  })

  it('formats capacity messages by collection type and add scope', () => {
    expect(collectionFullMessage('Lab set', 'synchronized', 'selection')).toBe(
      'Adding this selection to "Lab set" would exceed the 4-image limit for synchronized collections.',
    )
    expect(collectionFullMessage('Lab set', 'synchronized', 'image')).toBe(
      'Adding this image to "Lab set" would exceed the 4-image limit for synchronized collections.',
    )
    expect(collectionFullMessage('Lab set', 'sequence', 'selection')).toBe(
      'Adding this selection to "Lab set" would exceed the 20-image limit students have for sequence collections.',
    )
  })

  it('counts only collection rows with the matching user owner', () => {
    const rows = [
      makeCollectionSummary({
        id: 1,
        type: 'sequence',
        owners: [
          { kind: 'user', userId: 7, name: 'Student' },
          { kind: 'user', userId: 8, name: 'Co-owner' },
        ],
      }),
      makeCollectionSummary({
        id: 2,
        type: 'sequence',
        owners: [{ kind: 'program', programId: 3, name: 'Program' }],
      }),
      makeCollectionSummary({
        id: 3,
        type: 'synchronized',
        owners: [{ kind: 'user', userId: 7, name: 'Student' }],
      }),
    ]
    expect(ownedCollectionCounts(rows, 7)).toEqual({ sequence: 1, synchronized: 1 })
  })

  it('reports capped collection types only for students', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCollectionSummary({
          id: i + 1,
          type: 'sequence',
          owners: [{ kind: 'user', userId: 7, name: 'Student' }],
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeCollectionSummary({
          id: i + 11,
          type: 'synchronized',
          owners: [{ kind: 'user', userId: 7, name: 'Student' }],
        }),
      ),
    ]
    expect(studentTypesAtCap(rows, { id: 7, role: 'student' })).toEqual(
      new Set(['sequence', 'synchronized']),
    )
    expect(studentTypesAtCap(rows, { id: 7, role: 'instructor' })).toEqual(new Set())
  })
})

describe('collectionUtils mapping', () => {
  it('warns about a single private collection filed on Browse', () => {
    expect(privateFilingWarning()).toBe(
      'This collection is private. Students will not be able to see the images in this collection.',
    )
  })

  it('counts private collections in the bulk filing warning', () => {
    expect(privateFilingWarning(2, 3)).toBe(
      '2 of the 3 selected collections are private. Students will not be able to see the images in these collections.',
    )
  })

  it('maps a user owner and a program owner (#1531)', () => {
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
        permissions: {
          can_edit: false,
          can_delete: true,
          can_change_scope: false,
          can_transfer: true,
          can_hide: false,
        },
      }),
    )
    expect(summary).toMatchObject({
      id: 1,
      name: 'Skull comparison',
      type: 'synchronized',
      visibility: 'private',
      hidden: false,
      owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
      imageCount: 2,
      coverThumb: '/thumbs/skull.jpg?token=abc',
      coverImageId: null,
      coverBlank: false,
      version: 1,
      categoryId: null,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      permissions: {
        canEdit: false,
        canDelete: true,
        canChangeScope: false,
        canTransfer: true,
        canHide: false,
      },
    })
  })

  it('maps a pinned cover_image_id through to coverImageId', () => {
    const summary = apiCollectionSummaryToSummary(makeApiCollectionSummary({ cover_image_id: 42 }))
    expect(summary.coverImageId).toBe(42)
  })

  it('maps cover_blank through to coverBlank', () => {
    const summary = apiCollectionSummaryToSummary(
      makeApiCollectionSummary({ cover_blank: true, cover_thumb: null }),
    )
    expect(summary.coverBlank).toBe(true)
    expect(summary.coverThumb).toBeNull()
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

  it('describes owners for display (#1531)', () => {
    expect(describeCollectionOwner({ kind: 'user', userId: 1, name: 'Ada' })).toBe('Ada')
    expect(describeCollectionOwner({ kind: 'program', programId: 1, name: 'Nursing' })).toBe(
      'Nursing (program)',
    )
    expect(describeCollectionOwners([])).toBe('No owner')
    expect(describeCollectionOwners([{ kind: 'user', userId: 1, name: 'Ada' }])).toBe('Ada')
    expect(
      describeCollectionOwners([
        { kind: 'user', userId: 1, name: 'Ada' },
        { kind: 'user', userId: 2, name: 'Bob' },
      ]),
    ).toBe('Ada, Bob')
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
