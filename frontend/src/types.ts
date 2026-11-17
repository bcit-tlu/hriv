export interface ImageItem {
  id: number
  name: string
  thumb: string
  tileSources: string
  categoryId?: number | null
  copyright?: string | null
  description?: string | null
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

export interface ImageSourceInfo {
  originalFilename: string | null
  fileType: string | null
  uploadedByName: string | null
}

export interface Category {
  id: number
  label: string
  parentId: number | null
  children: Category[]
  images: ImageItem[]
  /** Collections filed into this category (#1527); `[]` when the flag is off. */
  collections: CollectionSummary[]
  programIds: number[]
  groupIds: number[]
  status?: string | null
  sortOrder: number
  version: number
  cardImageId?: number | null
  /** Server-resolved cover thumbnail (#1609): tokenized with a
   *  thumbnail-only tile token, so it renders for students even when the
   *  pinned image is inactive or hidden from them. Null → folder icon. */
  cardThumb?: string | null
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
  has_local_password?: boolean
  oidc_linked?: boolean
  must_change_password?: boolean
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
  inuksuks: boolean
  /** Collections tab + ``?collection=`` deep links (epic #1409). */
  collections: boolean
  collectionsStudentAccess: boolean
  /** My collections drawer on Browse (#1583). */
  collectionsHomeShelf: boolean
}

export const DEFAULT_FEATURES: Features = {
  inuksuks: false,
  collections: false,
  collectionsStudentAccess: true,
  collectionsHomeShelf: false,
}

// ── Collections (docs/collections.md) ─────────────────────

export type InuksukSource = 'mine' | 'instructor' | 'public'
export type BoardVisibility = 'private' | 'restricted' | 'public'
export interface InuksukView {
  x: number
  y: number
  zoom: number
  rotation: number
}
export interface ApiInuksuk extends InuksukView {
  id: number
  image_id: number
  category_name?: string | null
  title: string
  description: string | null
  thumb: string | null
  favourite: boolean
  sort_order: number
  version: number
  owners: { user_id: number | null; program_id: number | null; name: string; role: Role | null }[]
  board_ids: number[]
  source: InuksukSource | null
  permissions: { can_edit: boolean; can_delete: boolean }
  created_at: string
  updated_at: string
}
export interface ApiBoardSummary {
  id: number
  name: string
  description: string | null
  visibility: BoardVisibility
  owners: ApiInuksuk['owners']
  owner_program_id: number | null
  program_ids: number[]
  group_ids: number[]
  inuksuk_count: number
  cover_thumb: string | null
  sort_order: number
  version: number
  permissions: {
    can_edit: boolean
    can_change_scope: boolean
    can_delete: boolean
    can_transfer: boolean
  }
  created_at: string
  updated_at: string
}
export interface ApiBoard extends ApiBoardSummary {
  inuksuks: ApiInuksuk[]
}
export interface BoardAssignment {
  board_id: number
  sort_order?: number
}

export type CollectionType = 'synchronized' | 'sequence'

export type CollectionVisibility = 'private' | 'public' | 'restricted'

/** Scope-facet values: `student` = `studentCurated` rows;
 *  `instructor_admin` = every other curator kind (staff/instructor/admin
 *  user owners and program-owned rows all carry no student marker). */
export type CollectionScopeKind = 'student' | 'instructor_admin'

/** One owner of a collection (#1531): a user co-owner or the owning program.
 *  `role` is the user owner's current role when the API reports it. */
export type CollectionOwner =
  | { kind: 'user'; userId: number; name: string; role?: Role }
  | { kind: 'program'; programId: number; name: string }

/** UX hints from the API — the backend re-checks authority on every write. */
export interface CollectionPermissions {
  canEdit: boolean
  canDelete: boolean
  /** Whether the caller may change visibility/program/group scope (#1531). */
  canChangeScope: boolean
  canTransfer: boolean
  /** Curatorial hide/unhide — admins and instructors only (#1559). */
  canHide: boolean
}

export interface CollectionSummary {
  id: number
  name: string
  description: string | null
  type: CollectionType
  visibility: CollectionVisibility
  /** Curatorial hide (#1559): hidden collections are invisible to students
   * who don't own them; owners keep access. */
  hidden: boolean
  /** User co-owners plus the optional program owner; empty means orphaned (#1531). */
  owners: CollectionOwner[]
  /** Creator or any user-owner is a student — drives the scope-cluster
   *  badge (tile, table Scope cell, detail header) and the graph legend. */
  studentCurated: boolean
  imageCount: number
  coverThumb: string | null
  /** Pinned cover member id; `null` = first-member fallback. */
  coverImageId: number | null
  /** Explicit "no cover" pick — the tile renders the type-logo placeholder. */
  coverBlank: boolean
  version: number
  /** Category the collection is filed into (null = unfiled, not on Browse). */
  categoryId: number | null
  /** Tile-order position inside its filed category scope. */
  sortOrder: number
  /** Restriction scope (empty unless `visibility === 'restricted'`); carried
   *  on summaries so tiles can render program/group chips (#1567). */
  programIds: number[]
  groupIds: number[]
  createdAt: string
  updatedAt: string
  permissions: CollectionPermissions
}

export interface Collection extends CollectionSummary {
  /** Ordered member images (only those visible to the caller). */
  images: CollectionMember[]
  viewportState: Record<string, unknown>
  /** Nominal member count for unfiltered viewers; for students the backend
   * clamps it to `imageCount + 1` when members are hidden, so it signals
   * "restricted members exist" without revealing how many (#1529). */
  memberCount: number
}

export interface SlotViewport {
  x: number
  y: number
  zoom: number
  rotation?: number
}

export interface CollectionSlot {
  id: number
  viewport_state: SlotViewport | null
  thumb: string | null
  label: string | null
}

export interface CollectionMember extends ImageItem {
  slot?: CollectionSlot | null
  draftKey?: number
  inuksukId?: number
}
