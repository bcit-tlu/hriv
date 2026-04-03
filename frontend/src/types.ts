export interface ImageItem {
  id: number
  name: string
  thumb: string
  tileSources: string
  categoryId?: number | null
  copyright?: string | null
  note?: string | null
  programIds: number[]
  active: boolean
  createdAt?: string | null
  updatedAt?: string | null
  metadataExtra?: Record<string, unknown> | null
}

export interface Category {
  id: number
  label: string
  parentId: number | null
  children: Category[]
  images: ImageItem[]
  program?: string | null
  status?: string | null
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
  program_id?: number | null
  program_name?: string | null
  lastAccess?: string | null
}

export interface Program {
  id: number
  name: string
  created_at: string
  updated_at: string
}
