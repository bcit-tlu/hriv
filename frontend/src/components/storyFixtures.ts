/**
 * Shared fixture builders for component stories. Story-only — not imported by
 * app code, and excluded from coverage in vite.config.ts.
 */
import type { Category, Group, Program } from '../types'
import type { ApiImage, ApiUser } from '../api'

/** 1×1 transparent PNG so image previews render as blank rather than broken. */
const BLANK_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/** Build an ApiImage with sensible defaults; override any field per story. */
export function makeImage(overrides: Partial<ApiImage> = {}): ApiImage {
  return {
    id: 8801,
    name: 'north-elevation.jpg',
    thumb: BLANK_PX,
    tile_sources: '',
    category_id: 201,
    copyright: '2026 BCIT',
    note: 'Scanned from the original 35mm slide.',
    active: true,
    sort_order: 0,
    metadata_extra: null,
    version: 1,
    width: 4000,
    height: 3000,
    file_size: 5_242_880,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

export const USERS: ApiUser[] = [
  {
    id: 1,
    name: 'Dana Lee',
    email: 'dana.lee@bcit.ca',
    role: 'instructor',
    active: true,
    program_ids: [1],
    program_names: ['Architecture'],
    group_ids: [10],
    group_names: ['Faculty'],
    last_access: '2026-09-20T14:00:00Z',
    metadata_extra: null,
    created_at: '',
    updated_at: '',
  },
  {
    id: 2,
    name: 'Sam Rivera',
    email: 'sam.rivera@bcit.ca',
    role: 'student',
    active: true,
    program_ids: [2],
    program_names: ['Interior Design'],
    group_ids: [11],
    group_names: ['Students 2026'],
    last_access: null,
    metadata_extra: null,
    created_at: '',
    updated_at: '',
  },
]

export const PROGRAMS: Program[] = [
  { id: 1, name: 'Architecture', oidc_group: 'arch', created_at: '', updated_at: '' },
  { id: 2, name: 'Interior Design', oidc_group: 'intd', created_at: '', updated_at: '' },
  { id: 3, name: 'Building Engineering', oidc_group: null, created_at: '', updated_at: '' },
]

export const GROUPS: Group[] = [
  {
    id: 10,
    name: 'Faculty',
    description: 'Teaching staff',
    createdByUserId: 1,
    memberIds: [1, 2],
    instructorIds: [1],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 11,
    name: 'Students 2026',
    description: null,
    createdByUserId: 1,
    memberIds: [3, 4, 5],
    instructorIds: [],
    createdAt: '',
    updatedAt: '',
  },
]

/** Build a Category with sensible defaults; override any field per story. */
export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 100,
    label: 'Architecture',
    parentId: null,
    children: [],
    images: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    ...overrides,
  }
}

/**
 * A small nested category tree for move/picker dialogs. Components consume the
 * hierarchy via `node.children`, so this returns ROOTS ONLY with descendants
 * nested (never also flattened into the top-level array, which would render
 * every leaf twice).
 */
export function categoryTree(): Category[] {
  const italian = makeCategory({ id: 201, label: 'Italian Renaissance', parentId: 200 })
  const northern = makeCategory({ id: 202, label: 'Northern Renaissance', parentId: 200 })
  const renaissance = makeCategory({
    id: 200,
    label: 'Renaissance',
    parentId: null,
    children: [italian, northern],
  })
  const modern = makeCategory({ id: 300, label: 'Modern', parentId: null })
  return [renaissance, modern]
}
