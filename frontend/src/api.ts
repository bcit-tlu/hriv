const BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {}
  const res = await fetch(`${BASE}/api${path}`, {
    ...restInit,
    headers: { 'Content-Type': 'application/json', ...initHeaders },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

// ── Types matching the backend schemas ────────────────────

export interface ApiCategory {
  id: number
  label: string
  parent_id: number | null
  program: string | null
  status: string | null
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ApiCategoryTree extends ApiCategory {
  children: ApiCategoryTree[]
  images: ApiImage[]
}

export interface ApiImage {
  id: number
  label: string
  thumb: string
  tile_sources: string
  category_id: number | null
  copyright: string | null
  origin: string | null
  program: string | null
  status: string | null
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ApiUser {
  id: number
  name: string
  email: string
  role: string
  program: string | null
  last_access: string | null
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// ── Categories ───────────────────────────────────────────

export function fetchCategoryTree(): Promise<ApiCategoryTree[]> {
  return request('/categories/tree')
}

export function fetchCategories(parentId?: number): Promise<ApiCategory[]> {
  const qs = parentId != null ? `?parent_id=${parentId}` : ''
  return request(`/categories/${qs}`)
}

export function createCategory(body: {
  label: string
  parent_id?: number | null
  program?: string
  status?: string
}): Promise<ApiCategory> {
  return request('/categories/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteCategory(id: number): Promise<void> {
  return request(`/categories/${id}`, { method: 'DELETE' })
}

// ── Images ───────────────────────────────────────────────

export function fetchImages(categoryId?: number): Promise<ApiImage[]> {
  const qs = categoryId != null ? `?category_id=${categoryId}` : ''
  return request(`/images/${qs}`)
}

export function createImage(body: {
  label: string
  thumb: string
  tile_sources: string
  category_id?: number | null
  copyright?: string
  origin?: string
  program?: string
  status?: string
}): Promise<ApiImage> {
  return request('/images/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteImage(id: number): Promise<void> {
  return request(`/images/${id}`, { method: 'DELETE' })
}

// ── Users ────────────────────────────────────────────────

export function fetchUsers(): Promise<ApiUser[]> {
  return request('/users/')
}

export function loginUser(id: number): Promise<ApiUser> {
  return request(`/users/login/${id}`, { method: 'POST' })
}

export function createUser(body: {
  name: string
  email: string
  role: string
  program?: string
}): Promise<ApiUser> {
  return request('/users/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteUser(id: number): Promise<void> {
  return request(`/users/${id}`, { method: 'DELETE' })
}
