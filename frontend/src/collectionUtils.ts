import type { ApiCollection, ApiCollectionOwner, ApiCollectionSummary, ApiImage } from './api'
import type {
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  ImageItem,
  Role,
  User,
} from './types'

export const COLLECTION_TYPE_LABELS: Record<CollectionType, string> = {
  synchronized: 'Synchronized',
  sequence: 'Sequence',
}

export const COLLECTION_VISIBILITY_LABELS: Record<CollectionVisibility, string> = {
  private: 'Private',
  public: 'Public',
  restricted: 'Restricted',
}

/** `synchronized` collections show up to this many images side by side (backend 422 above it). */
export const SYNCHRONIZED_MAX_IMAGES = 4

/** Student caps mirror backend/app/models.py (#1583). */
export const STUDENT_SEQUENCE_MAX_IMAGES = 20
export const STUDENT_MAX_COLLECTIONS_PER_TYPE = 10
export const COLLECTIONS_AT_CAP_TOOLTIP = `You've reached the limit of ${STUDENT_MAX_COLLECTIONS_PER_TYPE} collections of each type.`

export function collectionImageCap(
  type: CollectionType,
  role: Role | null | undefined,
): number | null {
  if (type === 'synchronized') return SYNCHRONIZED_MAX_IMAGES
  return role === 'student' ? STUDENT_SEQUENCE_MAX_IMAGES : null
}

export function collectionFullMessage(
  name: string,
  type: CollectionType,
  scope: 'selection' | 'image',
): string {
  const subject = scope === 'selection' ? 'selection' : 'image'
  if (type === 'synchronized') {
    return `Adding this ${subject} to "${name}" would exceed the ${SYNCHRONIZED_MAX_IMAGES}-image limit for synchronized collections.`
  }
  return `Adding this ${subject} to "${name}" would exceed the ${STUDENT_SEQUENCE_MAX_IMAGES}-image limit students have for sequence collections.`
}

export function ownedCollectionCounts(
  rows: CollectionSummary[],
  userId: number,
): Record<CollectionType, number> {
  const counts: Record<CollectionType, number> = { sequence: 0, synchronized: 0 }
  for (const row of rows) {
    if (row.owners.some((owner) => owner.kind === 'user' && owner.userId === userId)) {
      counts[row.type] += 1
    }
  }
  return counts
}

export function studentTypesAtCap(
  rows: CollectionSummary[],
  user: Pick<User, 'id' | 'role'> | null | undefined,
): Set<CollectionType> {
  if (user?.role !== 'student') return new Set()
  const counts = ownedCollectionCounts(rows, user.id)
  return new Set(
    (['sequence', 'synchronized'] as const).filter(
      (type) => counts[type] >= STUDENT_MAX_COLLECTIONS_PER_TYPE,
    ),
  )
}

export function privateFilingWarning(privateCount = 1, total = 1): string {
  if (total > 1) {
    return `${privateCount} of the ${total} selected collections are private. Students will not be able to see the images in these collections.`
  }
  return 'This collection is private. Students will not be able to see the images in this collection.'
}

/** Students and staff may not use `restricted` visibility (API 403). */
export function canUseRestrictedVisibility(role: Role | undefined | null): boolean {
  return role === 'admin' || role === 'instructor'
}

export function apiCollectionOwnerToOwner(owner: ApiCollectionOwner): CollectionOwner | null {
  if (owner.user_id != null) return { kind: 'user', userId: owner.user_id, name: owner.name }
  if (owner.program_id != null) {
    return { kind: 'program', programId: owner.program_id, name: owner.name }
  }
  return null
}

export function apiCollectionSummaryToSummary(api: ApiCollectionSummary): CollectionSummary {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    type: api.type,
    visibility: api.visibility,
    hidden: api.hidden,
    owners: api.owners
      .map(apiCollectionOwnerToOwner)
      .filter((o): o is CollectionOwner => o != null),
    imageCount: api.image_count,
    coverThumb: api.cover_thumb,
    coverImageId: api.cover_image_id,
    coverBlank: api.cover_blank,
    version: api.version,
    categoryId: api.category_id,
    sortOrder: api.sort_order,
    programIds: api.program_ids,
    groupIds: api.group_ids,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    permissions: {
      canEdit: api.permissions.can_edit,
      canDelete: api.permissions.can_delete,
      canChangeScope: api.permissions.can_change_scope,
      canTransfer: api.permissions.can_transfer,
      canHide: api.permissions.can_hide,
    },
  }
}

export function apiImageToItem(img: ApiImage): ImageItem {
  return {
    id: img.id,
    name: img.name,
    thumb: img.thumb,
    tileSources: img.tile_sources,
    categoryId: img.category_id,
    copyright: img.copyright,
    note: img.note,
    active: img.active,
    sortOrder: img.sort_order,
    version: img.version,
    createdAt: img.created_at,
    updatedAt: img.updated_at,
    metadataExtra: img.metadata_extra,
    width: img.width,
    height: img.height,
    fileSize: img.file_size,
  }
}

export function apiCollectionToCollection(api: ApiCollection): Collection {
  return {
    ...apiCollectionSummaryToSummary(api),
    images: api.images.map(apiImageToItem),
    viewportState: api.viewport_state,
    memberCount: api.member_count,
  }
}

/** Human-readable owner line for cards and the detail header. */
export function describeCollectionOwner(owner: CollectionOwner): string {
  return owner.kind === 'program' ? `${owner.name} (program)` : owner.name
}

/** Plural owner line (#1531): joins co-owner names; 'No owner' when orphaned. */
export function describeCollectionOwners(owners: CollectionOwner[]): string {
  if (owners.length === 0) return 'No owner'
  return owners.map(describeCollectionOwner).join(', ')
}

/**
 * Parse the `?collection={id}` deep link. Returns `null` when the parameter is
 * missing or not a positive integer.
 */
export function parseCollectionIdParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('collection')
  if (raw == null || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Parse the `?item={image_id}` sequence-position param (#1416). It is only
 * meaningful next to a valid `?collection=` param — a bare `?item=` returns
 * `null`. Returns `null` when missing or not a positive integer.
 */
export function parseCollectionItemParam(search: string): number | null {
  if (parseCollectionIdParam(search) == null) return null
  const raw = new URLSearchParams(search).get('item')
  if (raw == null || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
