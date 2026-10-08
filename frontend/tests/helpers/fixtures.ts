/**
 * Shared test fixture factories for Category and ImageItem.
 *
 * Use these instead of defining local makeCategory/makeImage helpers in
 * individual test files. All fields have sensible defaults; pass overrides
 * to customise individual values.
 */

import type { ApiCollection, ApiCollectionSummary } from '../../src/api'
import type { Category, Collection, CollectionSummary, ImageItem } from '../../src/types'

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    label: 'Test Category',
    parentId: null,
    children: [],
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    cardImageId: null,
    ...overrides,
  }
}

export function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 100,
    name: 'Test Image',
    thumb: '/thumbs/test.jpg',
    tileSources: '/tiles/test.dzi',
    active: true,
    sortOrder: 0,
    version: 1,
    ...overrides,
  }
}

// ── Collections (#1414) ─────────────────────────────────────────────────

export function makeApiCollectionSummary(
  overrides: Partial<ApiCollectionSummary> = {},
): ApiCollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal vs lateral',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ user_id: 7, name: 'Ada Lovelace' }],
    image_count: 2,
    cover_thumb: '/thumbs/skull.jpg?token=abc',
    cover_image_id: null,
    version: 1,
    category_id: null,
    sort_order: 0,
    program_ids: [],
    group_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    permissions: {
      can_edit: true,
      can_delete: true,
      can_change_scope: true,
      can_transfer: false,
      can_hide: false,
    },
    ...overrides,
  }
}

export function makeApiCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  const images = overrides.images ?? []
  return {
    ...makeApiCollectionSummary(),
    images,
    viewport_state: {},
    // Nominal count matches the visible member list by default; pass an
    // explicit member_count > image_count to exercise the "all members are
    // restricted" empty state (#1529).
    member_count: images.length,
    ...overrides,
  }
}

export function makeCollectionSummary(
  overrides: Partial<CollectionSummary> = {},
): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal vs lateral',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: '/thumbs/skull.jpg?token=abc',
    coverImageId: null,
    version: 1,
    categoryId: null,
    sortOrder: 0,
    programIds: [],
    groupIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    permissions: {
      canEdit: true,
      canDelete: true,
      canChangeScope: true,
      canTransfer: false,
      canHide: false,
    },
    ...overrides,
  }
}

export function makeCollection(overrides: Partial<Collection> = {}): Collection {
  const images = overrides.images ?? []
  return {
    ...makeCollectionSummary(),
    images,
    viewportState: {},
    // Nominal count matches the visible member list by default; pass an
    // explicit memberCount > imageCount to exercise the "all members are
    // restricted" empty state (#1529).
    memberCount: images.length,
    ...overrides,
  }
}
