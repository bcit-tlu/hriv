const BASE = import.meta.env.VITE_API_URL ?? ''

function getStorage(): Storage | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    if (descriptor && 'value' in descriptor && descriptor.value) {
      return descriptor.value as Storage
    }
  } catch {
    // Continue to the browser window fallback below.
  }

  try {
    if (typeof window !== 'undefined') return window.localStorage ?? null
  } catch {
    // Storage can throw when blocked or unavailable.
  }

  return null
}

function readStoredToken(): string | null {
  try {
    return getStorage()?.getItem('hriv_token') ?? null
  } catch {
    return null
  }
}

let _token: string | null = readStoredToken()

// Unique per browser-tab identifier sent on every API call.  Allows the
// backend audit log to correlate all requests from a single tab, even when
// many students share the same JWT (shared "student@example.ca" account).
const SESSION_ID = globalThis.crypto?.randomUUID?.() ?? 'test-session'

export function setToken(token: string | null): void {
  _token = token
  const storage = getStorage()
  if (!storage) return
  try {
    if (token) {
      storage.setItem('hriv_token', token)
    } else {
      storage.removeItem('hriv_token')
    }
  } catch {
    // Storage may be unavailable in private browsing or non-browser tests.
  }
}

export function getToken(): string | null {
  return _token
}

/**
 * Remove all HRIV-scoped localStorage keys (`hriv_*` and `hriv-*`).
 * Called on logout and when a different user logs in to prevent
 * cross-account state leakage on shared browsers.
 *
 * Deliberately excludes `hrivpref:` UI preference keys because those are
 * already user-scoped (for example, persisted table column selections) and
 * should survive logout/login cycles for the same browser profile.
 */
export function clearUserStorage(): void {
  const storage = getStorage()
  if (!storage) {
    _token = null
    return
  }

  const keysToRemove: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && (key.startsWith('hriv_') || key.startsWith('hriv-'))) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key))
  } catch {
    // Ignore storage failures; clearing in-memory auth state is still useful.
  }
  _token = null
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'X-Session-ID': SESSION_ID }
  if (_token) h['Authorization'] = `Bearer ${_token}`
  return h
}

export class ApiError extends Error {
  status: number
  detail: string
  data?: unknown
  constructor(status: number, detail: string, data?: unknown) {
    super(`API ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.data = data
  }
}

export function userMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail.trim()
    const looksLikeHtml =
      /^<(!doctype|html|head|body|div|p|span|h[1-6]|pre|ul|ol|table|section|article)\b/i.test(
        detail,
      )
    const usable = detail.length > 0 && detail.length <= 200 && !looksLikeHtml

    if (err.status === 409) {
      if (!usable || /modified by another/i.test(detail)) {
        return 'This item was modified by another user. Please refresh and try again.'
      }
      return detail
    }
    if (err.status === 413) {
      return 'This file is too large to upload.'
    }
    if (err.status === 507) {
      if (usable) {
        return detail
      }
      return 'Not enough free space is available to upload this file.'
    }
    if (err.status >= 400 && err.status < 500) {
      if (usable) {
        return detail
      }
    }
    return fallback
  }
  // Network failure: fetch rejects with TypeError (e.g. "Failed to fetch").
  // XHR-based handlers in this module also reject with TypeError for
  // consistency, so all network-level failures surface here.
  if (err instanceof TypeError) {
    return 'Network error — check your connection and try again.'
  }
  // User-initiated aborts should not surface as errors
  if (err instanceof DOMException && err.name === 'AbortError') {
    return fallback
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMessageDetail(value: unknown): value is { message: string } {
  return (
    isRecord(value) &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

export interface AttachedCategory {
  id: number
  label: string
}

export interface AttachedCategoriesDetail {
  message: string
  category_ids: number[]
  categories: AttachedCategory[]
}

function isAttachedCategory(value: unknown): value is AttachedCategory {
  return isRecord(value) && typeof value.id === 'number' && typeof value.label === 'string'
}

export function isAttachedCategoriesDetail(value: unknown): value is AttachedCategoriesDetail {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    Array.isArray(value.category_ids) &&
    value.category_ids.every((id) => typeof id === 'number') &&
    Array.isArray(value.categories) &&
    value.categories.every(isAttachedCategory)
  )
}

export function attachedCategoriesFromError(err: unknown): AttachedCategory[] | null {
  if (err instanceof ApiError && isAttachedCategoriesDetail(err.data)) {
    return err.data.categories
  }
  return null
}

function parseError(text: string): { message: string; data?: unknown } {
  let message = text
  let data: unknown = undefined
  try {
    const body: unknown = JSON.parse(text)
    if (isRecord(body) && 'detail' in body) {
      const bodyDetail = body.detail
      data = bodyDetail
      if (typeof bodyDetail === 'string') message = bodyDetail
      else if (Array.isArray(bodyDetail))
        message = bodyDetail
          .map((e: unknown) =>
            isRecord(e) && typeof e.msg === 'string' ? e.msg : JSON.stringify(e),
          )
          .join('; ')
      else if (isMessageDetail(bodyDetail)) message = bodyDetail.message
      else if (bodyDetail !== undefined) message = String(bodyDetail)
    }
  } catch {
    /* use raw text */
  }
  return { message, data }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {}
  const res = await fetch(`${BASE}/api${path}`, {
    ...restInit,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...initHeaders,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const parsed = parseError(text)
    throw new ApiError(res.status, parsed.message, parsed.data)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

// ── Types matching the backend schemas ────────────────────

export interface ApiCategoryWarning {
  code: string
  message: string
}

export interface ApiCategory {
  id: number
  label: string
  parent_id: number | null
  program_ids: number[]
  group_ids: number[]
  status: string | null
  sort_order: number
  version: number
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
  /** Non-blocking advisories returned on create/update (e.g. program/group intersection). */
  warnings?: ApiCategoryWarning[]
}

export interface ApiCategoryTree extends ApiCategory {
  children: ApiCategoryTree[]
  images: ApiImage[]
}

export interface ApiImage {
  id: number
  name: string
  thumb: string
  tile_sources: string
  category_id: number | null
  copyright: string | null
  note: string | null
  active: boolean
  sort_order: number
  metadata_extra: Record<string, unknown> | null
  version: number
  width: number | null
  height: number | null
  file_size: number | null
  created_at: string
  updated_at: string
}

export interface ApiUser {
  id: number
  name: string
  email: string
  role: string
  program_ids: number[]
  program_names: string[]
  group_ids: number[]
  group_names: string[]
  last_access: string | null
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ApiProgram {
  id: number
  name: string
  oidc_group: string | null
  created_at: string
  updated_at: string
}

export interface ApiGroup {
  id: number
  name: string
  description: string | null
  created_by_user_id: number | null
  member_ids: number[]
  instructor_ids: number[]
  created_at: string
  updated_at: string
}

/** Minimal user projection returned by group member/instructor listings. */
export interface ApiGroupMember {
  id: number
  name: string
  email: string
  role: string
}

// ── Status ────────────────────────────────────────────────

export interface ApiStatus {
  maintenance: boolean
  version: string
}

export async function fetchStatus(): Promise<ApiStatus> {
  const res = await fetch(`${BASE}/api/status`)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const parsed = parseError(text)
    throw new ApiError(res.status, parsed.message, parsed.data)
  }
  return res.json() as Promise<ApiStatus>
}

// ── Categories ───────────────────────────────────────────

export function fetchCategoryTree(init?: RequestInit): Promise<ApiCategoryTree[]> {
  return request('/categories/tree', init)
}

export function createCategory(body: {
  label: string
  parent_id?: number | null
  program_ids?: number[]
  group_ids?: number[]
  status?: string
}): Promise<ApiCategory> {
  return request('/categories/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCategory(
  id: number,
  body: {
    label?: string
    parent_id?: number | null
    program_ids?: number[]
    group_ids?: number[]
    status?: string
    metadata_extra?: Record<string, unknown>
  },
  /** Pass the current category version for optimistic concurrency control */
  version?: number,
): Promise<ApiCategory> {
  const headers: Record<string, string> = {}
  if (version !== undefined) {
    headers['If-Match'] = `"${version}"`
  }
  return request(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers,
  })
}

export function deleteCategory(id: number): Promise<void> {
  return request(`/categories/${id}`, { method: 'DELETE' })
}

export function reorderCategories(
  items: Array<{ id: number; parent_id: number | null; sort_order: number }>,
): Promise<void> {
  return request('/categories/reorder', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}

// ── Images ───────────────────────────────────────────────

export function reorderImages(items: Array<{ id: number; sort_order: number }>): Promise<void> {
  return request('/images/reorder', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}

export function fetchImage(imageId: number): Promise<ApiImage> {
  return request(`/images/${imageId}`)
}

export function fetchImages(categoryId?: number): Promise<ApiImage[]> {
  const qs = categoryId != null ? `?category_id=${categoryId}` : ''
  return request(`/images/${qs}`)
}

export function fetchUncategorizedImages(init?: RequestInit): Promise<ApiImage[]> {
  return request('/images/?uncategorized=true', init)
}

export function updateImage(
  id: number,
  body: {
    name?: string
    thumb?: string
    tile_sources?: string
    category_id?: number | null
    copyright?: string
    note?: string
    active?: boolean
    metadata_extra?: Record<string, unknown>
    metadata_extra_merge?: Record<string, unknown | null>
  },
  /** Pass the current image version for optimistic concurrency control */
  version?: number,
): Promise<ApiImage> {
  const headers: Record<string, string> = {}
  if (version !== undefined) {
    headers['If-Match'] = `"${version}"`
  }
  return request(`/images/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers,
  })
}

export function deleteImage(id: number): Promise<void> {
  return request(`/images/${id}`, { method: 'DELETE' })
}

export function bulkUpdateImages(body: {
  image_ids: number[]
  category_id?: number | null
  copyright?: string
  note?: string
  active?: boolean
}): Promise<ApiImage[]> {
  return request('/images/bulk', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function bulkDeleteImages(body: { image_ids: number[] }): Promise<void> {
  return request('/images/bulk', {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

// ── OIDC ────────────────────────────────────────────────

export interface OidcStatus {
  enabled: boolean
}

export function fetchOidcEnabled(): Promise<OidcStatus> {
  return request('/auth/oidc/enabled')
}

/**
 * Return the full URL the browser should navigate to in order to start the
 * OIDC login flow.  This is a backend redirect endpoint, not a JSON API.
 */
export function getOidcLoginUrl(): string {
  return `${BASE}/api/auth/oidc/login`
}

// ── Users ────────────────────────────────────────────────

export function fetchUsers(role?: string): Promise<ApiUser[]> {
  const query = role ? `?role=${encodeURIComponent(role)}` : ''
  return request(`/users/${query}`)
}

export interface UserListParams {
  role?: string
  /** OR-filter: users belonging to any of these programs. */
  programIds?: number[]
  q?: string
  page?: number
  pageSize?: number
}

export interface PaginatedUsers {
  items: ApiUser[]
  /** Total matching users before pagination (from the X-Total-Count header). */
  total: number
}

/**
 * Server-side filtered/paginated user listing for the membership picker.
 * Reads the `X-Total-Count` header to drive page controls; falls back to the
 * returned item count when the header is absent (e.g. unpaginated response).
 */
export async function fetchUsersPaged(params: UserListParams): Promise<PaginatedUsers> {
  const qs = new URLSearchParams()
  if (params.role) qs.set('role', params.role)
  for (const id of params.programIds ?? []) qs.append('program_id', String(id))
  if (params.q && params.q.trim()) qs.set('q', params.q.trim())
  if (params.page != null) qs.set('page', String(params.page))
  if (params.pageSize != null) qs.set('page_size', String(params.pageSize))
  const query = qs.toString()
  const res = await fetch(`${BASE}/api/users/${query ? `?${query}` : ''}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const parsed = parseError(text)
    throw new ApiError(res.status, parsed.message, parsed.data)
  }
  const items = (await res.json()) as ApiUser[]
  const header = res.headers.get('X-Total-Count')
  const total = header != null ? Number(header) : items.length
  return { items, total }
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: ApiUser
}

export function loginUser(email: string, password: string): Promise<LoginResponse> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function createUser(body: {
  name: string
  email: string
  role: string
  password: string
  program_ids?: number[]
}): Promise<ApiUser> {
  return request('/users/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateUser(
  id: number,
  body: {
    name?: string
    email?: string
    role?: string
    password?: string
    program_ids?: number[]
  },
): Promise<ApiUser> {
  return request(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteUser(id: number): Promise<void> {
  return request(`/users/${id}`, { method: 'DELETE' })
}

export function bulkUpdateUserProgram(body: {
  user_ids: number[]
  program_ids: number[]
}): Promise<ApiUser[]> {
  return request('/users/bulk/program', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function bulkUpdateUserRole(body: { user_ids: number[]; role: string }): Promise<ApiUser[]> {
  return request('/users/bulk/role', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function bulkDeleteUsers(body: { user_ids: number[] }): Promise<void> {
  return request('/users/bulk', {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

// ── Programs ────────────────────────────────────────────

export function fetchPrograms(): Promise<ApiProgram[]> {
  return request('/programs/')
}

export function createProgram(body: {
  name: string
  oidc_group?: string | null
}): Promise<ApiProgram> {
  return request('/programs/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateProgram(
  id: number,
  body: { name?: string; oidc_group?: string | null },
): Promise<ApiProgram> {
  return request(`/programs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteProgram(id: number): Promise<void> {
  return request(`/programs/${id}`, { method: 'DELETE' })
}

// ── Groups ──────────────────────────────────────────────

export function fetchGroups(): Promise<ApiGroup[]> {
  return request('/groups/')
}

export function createGroup(body: {
  name: string
  description?: string | null
}): Promise<ApiGroup> {
  return request('/groups/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateGroup(
  id: number,
  body: { name?: string; description?: string | null },
): Promise<ApiGroup> {
  return request(`/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteGroup(id: number): Promise<void> {
  return request(`/groups/${id}`, { method: 'DELETE' })
}

export function fetchGroupMembers(groupId: number): Promise<ApiGroupMember[]> {
  return request(`/groups/${groupId}/members`)
}

export function addGroupMember(groupId: number, userId: number): Promise<ApiGroup> {
  return request(`/groups/${groupId}/members/${userId}`, { method: 'POST' })
}

export function removeGroupMember(groupId: number, userId: number): Promise<ApiGroup> {
  return request(`/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export function fetchGroupInstructors(groupId: number): Promise<ApiGroupMember[]> {
  return request(`/groups/${groupId}/instructors`)
}

export function addGroupInstructor(groupId: number, userId: number): Promise<ApiGroup> {
  return request(`/groups/${groupId}/instructors/${userId}`, {
    method: 'POST',
  })
}

export function removeGroupInstructor(groupId: number, userId: number): Promise<ApiGroup> {
  return request(`/groups/${groupId}/instructors/${userId}`, {
    method: 'DELETE',
  })
}

export function addGroupMembersBulk(groupId: number, userIds: number[]): Promise<ApiGroup> {
  return request(`/groups/${groupId}/members/bulk`, {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  })
}

export function removeGroupMembersBulk(groupId: number, userIds: number[]): Promise<ApiGroup> {
  return request(`/groups/${groupId}/members/bulk`, {
    method: 'DELETE',
    body: JSON.stringify({ user_ids: userIds }),
  })
}

export function addGroupInstructorsBulk(groupId: number, userIds: number[]): Promise<ApiGroup> {
  return request(`/groups/${groupId}/instructors/bulk`, {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  })
}

export function removeGroupInstructorsBulk(groupId: number, userIds: number[]): Promise<ApiGroup> {
  return request(`/groups/${groupId}/instructors/bulk`, {
    method: 'DELETE',
    body: JSON.stringify({ user_ids: userIds }),
  })
}

// ── Announcement ────────────────────────────────────────

export interface ApiAnnouncement {
  id: number
  message: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export function fetchAnnouncement(): Promise<ApiAnnouncement> {
  return request('/announcement/')
}

export function updateAnnouncement(body: {
  message?: string
  enabled?: boolean
}): Promise<ApiAnnouncement> {
  return request('/announcement/', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// ── Changelog ────────────────────────────────────────────

export interface ApiChangelogEntry {
  id: number
  title: string
  body: string
  published_at: string
  created_at: string
  updated_at: string
}

export function fetchChangelogEntries(): Promise<ApiChangelogEntry[]> {
  return request('/changelog/')
}

export function createChangelogEntry(body: {
  title: string
  body: string
}): Promise<ApiChangelogEntry> {
  return request('/changelog/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateChangelogEntry(
  id: number,
  body: { title?: string; body?: string },
): Promise<ApiChangelogEntry> {
  return request(`/changelog/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteChangelogEntry(id: number): Promise<void> {
  return request(`/changelog/${id}`, { method: 'DELETE' })
}

export function markChangelogRead(): Promise<{ changelog_last_read_at: string }> {
  return request('/changelog/mark-read', { method: 'POST' })
}

// ── Source Images ───────────────────────────────────────

export interface ApiSourceImage {
  id: number
  original_filename: string
  status: string
  progress: number
  error_message: string | null
  status_message: string | null
  name: string | null
  category_id: number | null
  copyright: string | null
  note: string | null
  active: boolean
  image_id: number | null
  file_size: number | null
  source_checksum: string | null
  tile_settings_hash: string | null
  tiles_generated_at: string | null
  tile_cache_status: 'current' | 'missing' | 'stale' | 'failed'
  created_at: string
  updated_at: string
}

export async function uploadSourceImage(
  file: File,
  name?: string,
  categoryId?: number | null,
  copyright?: string,
  note?: string,
  active?: boolean,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ApiSourceImage> {
  const form = new FormData()
  form.append('file', file)
  if (name) form.append('name', name)
  if (categoryId != null) form.append('category_id', String(categoryId))
  if (copyright) form.append('copyright', copyright)
  if (note) form.append('note', note)
  if (active !== undefined) form.append('active', String(active))

  // Use XMLHttpRequest for upload progress reporting (essential for large TIFFs)
  return new Promise<ApiSourceImage>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/source-images/upload`)

    const hdrs = authHeaders()
    for (const [k, v] of Object.entries(hdrs)) {
      xhr.setRequestHeader(k, v)
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total)
        }
      })
    }

    xhr.addEventListener('load', () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as ApiSourceImage)
        } else {
          const parsed = parseError(xhr.responseText || xhr.statusText)
          reject(new ApiError(xhr.status, parsed.message, parsed.data))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse upload response'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new TypeError('Network error'))
    })

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'))
    })

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(form)
  })
}

export function fetchSourceImage(id: number): Promise<ApiSourceImage> {
  return request(`/source-images/${id}`)
}

export async function replaceImage(
  imageId: number,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  metadata?: {
    name?: string
    category_id?: number | null
    copyright?: string
    note?: string
    active?: boolean
    metadata_extra?: Record<string, unknown>
  },
): Promise<ApiSourceImage> {
  const form = new FormData()
  form.append('file', file)
  if (metadata) {
    if (metadata.name !== undefined) form.append('name', metadata.name)
    if (metadata.category_id !== undefined)
      form.append('category_id', metadata.category_id === null ? '' : String(metadata.category_id))
    if (metadata.copyright !== undefined) form.append('copyright', metadata.copyright)
    if (metadata.note !== undefined) form.append('note', metadata.note)
    if (metadata.active !== undefined) form.append('active', String(metadata.active))
    if (metadata.metadata_extra !== undefined)
      form.append('metadata_extra', JSON.stringify(metadata.metadata_extra))
  }

  return new Promise<ApiSourceImage>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/images/${imageId}/replace`)

    const hdrs = authHeaders()
    for (const [k, v] of Object.entries(hdrs)) {
      xhr.setRequestHeader(k, v)
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total)
        }
      })
    }

    xhr.addEventListener('load', () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as ApiSourceImage)
        } else {
          const parsed = parseError(xhr.responseText || xhr.statusText)
          reject(new ApiError(xhr.status, parsed.message, parsed.data))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse replace response'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new TypeError('Network error'))
    })

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'))
    })

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(form)
  })
}

// ── Bulk Import ────────────────────────────────────────

export interface ApiBulkImportJob {
  id: number
  status: string
  category_id: number | null
  total_count: number
  completed_count: number
  failed_count: number
  errors: Array<{ filename: string; error: string }> | null
  created_at: string
  updated_at: string
}

export async function bulkImportImages(
  files: File[],
  categoryId: number | null,
  copyright?: string,
  note?: string,
  active?: boolean,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ApiBulkImportJob> {
  const form = new FormData()
  for (const file of files) {
    form.append('files', file)
  }
  if (categoryId != null) form.append('category_id', String(categoryId))
  if (copyright) form.append('copyright', copyright)
  if (note) form.append('note', note)
  if (active !== undefined) form.append('active', String(active))

  return new Promise<ApiBulkImportJob>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/admin/bulk-import/`)

    const hdrs = authHeaders()
    for (const [k, v] of Object.entries(hdrs)) {
      xhr.setRequestHeader(k, v)
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total)
        }
      })
    }

    xhr.addEventListener('load', () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as ApiBulkImportJob)
        } else {
          const parsed = parseError(xhr.responseText || xhr.statusText)
          reject(new ApiError(xhr.status, parsed.message, parsed.data))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse bulk import response'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new TypeError('Network error'))
    })

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'))
    })

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(form)
  })
}

export function fetchBulkImportJob(jobId: number): Promise<ApiBulkImportJob> {
  return request(`/admin/bulk-import/${jobId}`)
}

// ── Issues ──────────────────────────────────────────────

export interface ReportIssueResponse {
  destination: string
  tracking_url: string | null
  issue_url: string | null
}

export function reportIssue(body: {
  description: string
  page_url: string
}): Promise<ReportIssueResponse> {
  return request('/issues/report', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── Background Admin Tasks ──────────────────────────────

export interface AdminTask {
  id: number
  task_type: string
  status: string
  progress: number
  log: string
  original_filename?: string | null
  result_filename: string | null
  error_message: string | null
  created_by: number | null
  created_at: string | null
  updated_at: string | null
}

export interface FilesImportArchive {
  archive_task_id: number
  original_filename: string | null
  size_bytes: number
  created_at: string | null
  last_status: string
}

export interface FilesImportArchiveDeleteResponse {
  archive_task_id: number
  deleted: boolean
  path: string
}

export interface BackupSnapshotSummary {
  name: string
  blob_name: string
  size: number
  created_at: string | null
}

export interface BackupSnapshotManifestEntry {
  size: number
  sha256: string
}

export interface BackupSnapshotManifest {
  snapshot_name: string
  created_at: string | null
  files: Record<string, BackupSnapshotManifestEntry>
  [key: string]: unknown
}

export function startDbExport(): Promise<AdminTask> {
  return request('/admin/tasks/db-export', { method: 'POST' })
}

export async function startDbImport(file: File): Promise<AdminTask> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/admin/tasks/db-import`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const parsed = parseError(text)
    throw new ApiError(res.status, parsed.message, parsed.data)
  }
  return res.json() as Promise<AdminTask>
}

export function startFilesExport(): Promise<AdminTask> {
  return request('/admin/tasks/files-export', { method: 'POST' })
}

export function fetchFilesImportArchives(): Promise<FilesImportArchive[]> {
  return request('/admin/tasks/files-import/archives')
}

export function rerunFilesImportArchive(archiveTaskId: number): Promise<AdminTask> {
  return request('/admin/tasks/files-import/rerun', {
    method: 'POST',
    body: JSON.stringify({ archive_task_id: archiveTaskId }),
  })
}

export function deleteFilesImportArchive(
  archiveTaskId: number,
): Promise<FilesImportArchiveDeleteResponse> {
  return request(`/admin/tasks/files-import/archives/${archiveTaskId}`, {
    method: 'DELETE',
  })
}

export interface ExportArchive {
  task_id: number
  task_type: string
  artifact_role: 'result'
  filename: string
  size_bytes: number
  status: string
  created_at: string | null
  updated_at: string | null
  purgeable: boolean
}

export interface ExportArchivesResponse {
  archives: ExportArchive[]
  total_size_bytes: number
}

export function listExportArchives(): Promise<ExportArchivesResponse> {
  return request('/admin/tasks/backup-archives')
}

export function purgeExportArchive(
  taskId: number,
  artifactRole: 'result',
): Promise<{ deleted: boolean; task_id: number; artifact_role: string; size_bytes: number }> {
  return request(`/admin/tasks/backup-archives/${taskId}/${artifactRole}`, { method: 'DELETE' })
}

export function listBackupSnapshots(): Promise<BackupSnapshotSummary[]> {
  return request('/admin/backups/snapshots')
}

export function fetchBackupSnapshotManifest(snapshotName: string): Promise<BackupSnapshotManifest> {
  return request(`/admin/backups/snapshots/${encodeURIComponent(snapshotName)}/manifest`)
}

export function startFileRestore(body: {
  snapshot_name: string
  member_path: string
}): Promise<AdminTask> {
  return request('/admin/tasks/file-restore', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Create a filesystem-import task in ``uploading`` status.
 *
 * This is step 1 of a two-step flow: init → upload.  The returned task
 * should be added to the active-task list and polled immediately so the
 * user sees the "Uploading" state.  Step 2 is {@link uploadTaskFile}.
 */
export function initFilesImport(filename: string): Promise<AdminTask> {
  return request(`/admin/tasks/files-import?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
  })
}

const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MiB
const UPLOAD_MAX_RETRIES = 3
const UPLOAD_RETRY_BASE_MS = 1000

function isRetryableUploadStatus(status: number): boolean {
  return (status >= 500 && status !== 507) || status === 408 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uploadChunk(
  taskId: number,
  file: File,
  offset: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes_received: number; status: string }> {
  return new Promise<{ bytes_received: number; status: string }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, file.size)
    const chunk = file.slice(offset, end, 'application/octet-stream')
    const xhr = new XMLHttpRequest()
    xhr.open('PATCH', `${BASE}/api/admin/tasks/${taskId}/upload`)
    xhr.setRequestHeader('Upload-Offset', String(offset))
    xhr.setRequestHeader('Upload-Length', String(file.size))
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    const hdrs = authHeaders()
    for (const [k, v] of Object.entries(hdrs)) {
      xhr.setRequestHeader(k, v)
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress((offset + e.loaded) / file.size)
        }
      })
    }

    const onAbort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', onAbort)
      if (xhr.status === 409) {
        try {
          const body = JSON.parse(xhr.responseText) as Record<string, unknown>
          const resp = (body?.detail ?? body) as {
            bytes_received: number
            status: string
          }
          reject(new ApiError(409, 'Upload offset conflict', resp))
        } catch {
          reject(new ApiError(409, 'Upload offset conflict'))
        }
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { bytes_received: number; status: string })
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Failed to parse upload chunk response'))
        }
      } else {
        const parsed = parseError(xhr.responseText || xhr.statusText)
        reject(new ApiError(xhr.status, parsed.message, parsed.data))
      }
    })

    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new TypeError('Network error'))
    })

    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Upload aborted', 'AbortError'))
    })

    xhr.send(chunk)
  })
}

/**
 * Return the current upload offset for resuming a chunked upload.
 *
 * Useful when a browser tab is reloaded or a network error occurred
 * mid-transfer: the client can ask the server how much of the file it
 * already has before sending the next chunk.
 */
export function getUploadStatus(
  taskId: number,
  signal?: AbortSignal,
): Promise<{ bytes_received: number; status: string }> {
  return request(`/admin/tasks/${taskId}/upload`, { signal })
}

/**
 * Finalize a chunked filesystem-import upload once the client believes all
 * bytes have been received.
 */
export function finalizeUpload(
  taskId: number,
  totalBytes: number,
  signal?: AbortSignal,
): Promise<AdminTask> {
  return request(`/admin/tasks/${taskId}/upload/finalize`, {
    method: 'POST',
    body: JSON.stringify({ total_bytes: totalBytes }),
    signal,
  })
}

/**
 * Small-file fast path: upload the archive in a single raw PUT.
 *
 * Archives that fit in one chunk (<= `UPLOAD_CHUNK_SIZE`) are sent in one
 * request to avoid the extra round-trips of the chunked/resumable path. The
 * backend streams raw bytes directly to the data volume without any multipart
 * /tmp spooling.
 */
function uploadTaskFileRaw(
  taskId: number,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AdminTask> {
  return new Promise<AdminTask>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${BASE}/api/admin/tasks/${taskId}/upload`)

    const hdrs = authHeaders()
    for (const [k, v] of Object.entries(hdrs)) {
      xhr.setRequestHeader(k, v)
    }
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total)
        }
      })
    }

    xhr.addEventListener('load', () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as AdminTask)
        } else {
          const parsed = parseError(xhr.responseText || xhr.statusText)
          reject(new ApiError(xhr.status, parsed.message, parsed.data))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse upload response'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new TypeError('Network error'))
    })

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'))
    })

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(file)
  })
}

/**
 * Upload the archive for an ``uploading``-status task using resumable chunks.
 *
 * Archives larger than `UPLOAD_CHUNK_SIZE` are sliced into 10 MiB pieces and
 * sent via `PATCH` requests with `Upload-Offset` and `Upload-Length` headers.
 * Network failures and 5xx responses are retried with a short exponential
 * backoff; 409 offset-conflict responses trigger a resync from the server.
 * Once the reported `bytes_received` equals `file.size`, the client calls
 * `POST .../finalize`.
 *
 * On success the backend transitions the task to ``pending`` and enqueues it.
 *
 * @param onProgress  Called with a fraction (0–1) as each chunk streams.
 */
export function uploadTaskFile(
  taskId: number,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AdminTask> {
  if (file.size <= UPLOAD_CHUNK_SIZE) {
    return uploadTaskFileRaw(taskId, file, onProgress, signal)
  }

  return new Promise<AdminTask>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    let currentOffset = 0
    let consecutiveRetries = 0

    async function resync(): Promise<void> {
      const status = await getUploadStatus(taskId, signal)
      if (status.status !== 'uploading') {
        throw new ApiError(409, `Task is in '${status.status}' state, expected 'uploading'`)
      }
      currentOffset = status.bytes_received
      consecutiveRetries = 0
    }

    async function uploadChunks(): Promise<void> {
      while (currentOffset < file.size) {
        if (signal?.aborted) {
          throw new DOMException('Upload aborted', 'AbortError')
        }
        try {
          const resp = await uploadChunk(taskId, file, currentOffset, onProgress, signal)
          if (resp.status !== 'uploading') {
            // The backend moved the task out of uploading state unexpectedly.
            throw new ApiError(409, `Task is in '${resp.status}' state, expected 'uploading'`)
          }
          if (resp.bytes_received <= currentOffset) {
            // Server did not accept the chunk (offset conflict). Resync
            // to avoid an infinite loop.
            await resync()
            continue
          }
          currentOffset = resp.bytes_received
          consecutiveRetries = 0
        } catch (err: unknown) {
          if (err instanceof ApiError && err.status === 409) {
            const data =
              isRecord(err.data) && typeof err.data.bytes_received === 'number'
                ? (err.data as { bytes_received: number; status: string })
                : null
            if (data && data.status !== 'uploading') {
              throw new ApiError(409, `Task is in '${data.status}' state, expected 'uploading'`)
            }
            currentOffset =
              data?.bytes_received ?? (await getUploadStatus(taskId, signal)).bytes_received
            consecutiveRetries = 0
            continue
          }
          if (
            err instanceof TypeError ||
            (err instanceof ApiError && isRetryableUploadStatus(err.status))
          ) {
            consecutiveRetries++
            if (consecutiveRetries > UPLOAD_MAX_RETRIES) throw err
            await sleep(UPLOAD_RETRY_BASE_MS * consecutiveRetries)
            continue
          }
          throw err
        }
      }
    }

    async function run() {
      try {
        await resync()
        await uploadChunks()
      } catch (err: unknown) {
        reject(err)
        return
      }

      try {
        const task = await finalizeUpload(taskId, file.size, signal)
        resolve(task)
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) {
          // Finalize reported a size mismatch; resync and try again once.
          try {
            await resync()
            await uploadChunks()
            const task = await finalizeUpload(taskId, file.size, signal)
            resolve(task)
          } catch (finalizeErr: unknown) {
            reject(finalizeErr)
          }
        } else {
          reject(err)
        }
      }
    }

    run()
  })
}

/**
 * Convenience wrapper that runs both init + upload in sequence.
 *
 * @param onInitiated  Called once the task record exists (before the
 *                     upload starts) so the caller can begin polling.
 * @param onUploadProgress  Fraction 0–1 during the upload phase.
 */
export async function startFilesImport(
  file: File,
  onInitiated?: (task: AdminTask) => void,
  onUploadProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AdminTask> {
  const task = await initFilesImport(file.name)
  if (onInitiated) onInitiated(task)
  return uploadTaskFile(task.id, file, onUploadProgress, signal)
}

export function fetchAdminTasks(): Promise<AdminTask[]> {
  return request('/admin/tasks')
}

export function fetchAdminTask(taskId: number): Promise<AdminTask> {
  return request(`/admin/tasks/${taskId}`)
}

export function cancelAdminTask(taskId: number): Promise<AdminTask> {
  return request(`/admin/tasks/${taskId}/cancel`, { method: 'POST' })
}

export interface VersionsResponse {
  backend: string
  backup: string
}

export function fetchVersions(): Promise<VersionsResponse> {
  return request('/admin/version')
}

// Frontend version is served by the frontend's own nginx at ``/version``
// (outside the ``/api`` proxy prefix), rendered from the ``APP_VERSION``
// env var via ``envsubst`` on the ConfigMap-mounted nginx template at
// container start. See ``charts/frontend/files/default.conf.template``.
//
// We intentionally bypass ``request`` (which prepends ``/api`` and
// attaches auth headers) because this endpoint lives outside the
// backend-proxied path and carries no auth requirement. In dev mode
// (``npm run dev``), Vite's proxy does not forward ``/version`` so the
// fetch will fall through to the dev server's 404 response; callers
// treat the rejection as "frontend: dev" to keep local development
// non-fatal.
export interface FrontendVersionResponse {
  frontend: string
}

export async function fetchFrontendVersion(): Promise<FrontendVersionResponse> {
  if (import.meta.env.MODE === 'development') {
    return { frontend: 'dev' }
  }

  // NB: absolute path, not ``${BASE}/version``. ``BASE`` is
  // ``VITE_API_URL`` (the *backend* base), so if it's ever set to a
  // cross-origin URL (e.g. ``https://api.example.com``) the fetch would
  // hit the backend's origin — which does not serve ``/version`` — and
  // silently fall back to ``"dev"`` even in a managed deploy. This
  // endpoint is served by the frontend's own nginx on the same origin
  // as the SPA regardless of ``VITE_API_URL``.
  const res = await fetch('/version', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Frontend /version ${res.status}`)
  }
  return res.json() as Promise<FrontendVersionResponse>
}

export async function downloadAdminTaskResult(taskId: number): Promise<void> {
  // Obtain a short-lived download token, then navigate the browser to the
  // token-authenticated download URL (no JS buffering needed).
  const { token } = await request<{ token: string }>(`/admin/tasks/${taskId}/download-token`, {
    method: 'POST',
  })
  window.location.href = `${BASE}/api/admin/tasks/${taskId}/download?token=${encodeURIComponent(token)}`
}
