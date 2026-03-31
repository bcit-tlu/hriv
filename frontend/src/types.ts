export interface ImageItem {
  id: number
  label: string
  thumb: string
  tileSources: string
  copyright?: string | null
  origin?: string | null
  programIds: number[]
  active: boolean
}

export interface Category {
  id: number
  label: string
  parentId: number | null
  children: Category[]
  images: ImageItem[]
  program?: string | null
  status?: string | null
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
