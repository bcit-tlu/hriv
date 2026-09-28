import type { ApiCollection, ApiCollectionOwner, ApiCollectionSummary, ApiImage } from './api'
import type {
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  ImageItem,
  Role,
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

/** Students and staff may not use `restricted` visibility (API 403). */
export function canUseRestrictedVisibility(role: Role | undefined | null): boolean {
  return role === 'admin' || role === 'instructor'
}

export function apiCollectionOwnerToOwner(owner: ApiCollectionOwner): CollectionOwner {
  if (owner == null) return null
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
    owner: apiCollectionOwnerToOwner(api.owner),
    imageCount: api.image_count,
    coverThumb: api.cover_thumb,
    version: api.version,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    permissions: {
      canEdit: api.permissions.can_edit,
      canDelete: api.permissions.can_delete,
      canTransfer: api.permissions.can_transfer,
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
    programIds: api.program_ids,
    groupIds: api.group_ids,
    viewportState: api.viewport_state,
  }
}

/** Human-readable owner line for cards and the detail header. */
export function describeCollectionOwner(owner: CollectionOwner): string {
  if (owner == null) return 'No owner'
  return owner.kind === 'program' ? `${owner.name} (program)` : owner.name
}

/**
 * Parse the `?collection={id}` deep link. Returns `null` when the parameter is
 * missing or not a positive integer. `?item=` is reserved for #1416 and is
 * intentionally not parsed here.
 */
export function parseCollectionIdParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('collection')
  if (raw == null || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
