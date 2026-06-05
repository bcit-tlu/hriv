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
  status?: string | null
  sortOrder: number
  cardImageId?: number | null
  metadataExtra?: Record<string, unknown> | null
}

export const MAX_DEPTH = 6

export type Role = 'admin' | 'instructor' | 'student'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  program_ids: number[]
  program_names: string[]
  lastAccess?: string | null
}

export interface Program {
  id: number
  name: string
  oidc_group: string | null
  /** Parent tenant id; null for tenant (top-level) programs. */
  parent_program_id: number | null
  /** True when the program is a cohort (has a parent tenant). */
  is_cohort: boolean
  created_at: string
  updated_at: string
}
