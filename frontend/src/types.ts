export interface ImageItem {
  id: number
  name: string
  thumb: string
  tileSources: string
  categoryId?: number | null
  copyright?: string | null
  note?: string | null
  active: boolean
  sortOrder: number
  version: number
  createdAt?: string | null
  updatedAt?: string | null
  metadataExtra?: Record<string, unknown> | null
  width?: number | null
  height?: number | null
  fileSize?: number | null
}

export interface Category {
  id: number
  label: string
  parentId: number | null
  children: Category[]
  images: ImageItem[]
  programIds: number[]
  groupIds: number[]
  status?: string | null
  sortOrder: number
  version: number
  cardImageId?: number | null
  metadataExtra?: Record<string, unknown> | null
}

export const MAX_DEPTH = 6

export type Role = 'admin' | 'instructor' | 'staff' | 'student'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  active: boolean
  program_ids: number[]
  program_names: string[]
  group_ids: number[]
  group_names: string[]
  lastAccess?: string | null
  metadataExtra?: Record<string, unknown> | null
}

export interface Program {
  id: number
  name: string
  oidc_group: string | null
  created_at: string
  updated_at: string
}

export interface Group {
  id: number
  name: string
  description: string | null
  createdByUserId: number | null
  memberIds: number[]
  instructorIds: number[]
  createdAt: string
  updatedAt: string
}

// ── Deployment feature flags (GET /api/features) ──────────

/**
 * Flags a deployment turns on per environment (chart values). Unknown flags
 * are read as ``false`` so a frontend that ships ahead of the backend hides
 * the surface rather than rendering it against a 404 API.
 */
export interface Features {
  /** Collections tab + ``?collection=`` deep links (epic #1409). */
  collections: boolean
}

export const DEFAULT_FEATURES: Features = { collections: false }

// ── Collections (docs/collections.md) ─────────────────────

export type CollectionType = 'synchronized' | 'sequence'

export type CollectionVisibility = 'private' | 'public' | 'restricted'

/** Owner of a collection: a user, a program (after transfer, #1413), or nobody (orphaned). */
export type CollectionOwner =
  | { kind: 'user'; userId: number; name: string }
  | { kind: 'program'; programId: number; name: string }
  | null

/** UX hints from the API — the backend re-checks authority on every write. */
export interface CollectionPermissions {
  canEdit: boolean
  canDelete: boolean
  canTransfer: boolean
}

export interface CollectionSummary {
  id: number
  name: string
  description: string | null
  type: CollectionType
  visibility: CollectionVisibility
  owner: CollectionOwner
  imageCount: number
  coverThumb: string | null
  version: number
  createdAt: string
  updatedAt: string
  permissions: CollectionPermissions
}

export interface Collection extends CollectionSummary {
  /** Ordered member images (only those visible to the caller). */
  images: ImageItem[]
  programIds: number[]
  groupIds: number[]
  viewportState: Record<string, unknown>
}
