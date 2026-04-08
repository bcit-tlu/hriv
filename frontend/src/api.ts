const BASE = import.meta.env.VITE_API_URL ?? ''

let _token: string | null = localStorage.getItem('corgi_token')

// Unique per browser-tab identifier sent on every API call.  Allows the
// backend audit log to correlate all requests from a single tab, even when
// many students share the same JWT (shared "student@bcit.ca" account).
const SESSION_ID = crypto.randomUUID()

export function setToken(token: string | null): void {
  _token = token
  if (token) {
    localStorage.setItem('corgi_token', token)
  } else {
    localStorage.removeItem('corgi_token')
  }
}

export function getToken(): string | null {
  return _token
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'X-Session-ID': SESSION_ID }
  if (_token) h['Authorization'] = `Bearer ${_token}`
  return h
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {}
  const res = await fetch(`${BASE}/api${path}`, {
    ...restInit,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...initHeaders },
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
  name: string
  thumb: string
  tile_sources: string
  category_id: number | null
  copyright: string | null
  note: string | null
  program_ids: number[]
  active: boolean
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ApiUser {
  id: number
  name: string
  email: string
  role: string
  program_id: number | null
  program_name: string | null
  last_access: string | null
  metadata_extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ApiProgram {
  id: number
  name: string
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

export function updateCategory(
  id: number,
  body: {
    label?: string
    parent_id?: number | null
    program?: string
    status?: string
    metadata_extra?: Record<string, unknown>
  },
): Promise<ApiCategory> {
  return request(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
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

export function fetchImages(categoryId?: number): Promise<ApiImage[]> {
  const qs = categoryId != null ? `?category_id=${categoryId}` : ''
  return request(`/images/${qs}`)
}

export function fetchUncategorizedImages(): Promise<ApiImage[]> {
  return request('/images/?uncategorized=true')
}

export function createImage(body: {
  name: string
  thumb: string
  tile_sources: string
  category_id?: number | null
  copyright?: string
  note?: string
  program_ids?: number[]
  active?: boolean
}): Promise<ApiImage> {
  return request('/images/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
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
    program_ids?: number[]
    active?: boolean
    metadata_extra?: Record<string, unknown>
  },
): Promise<ApiImage> {
  return request(`/images/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
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
  program_ids?: number[]
  active?: boolean
}): Promise<ApiImage[]> {
  return request('/images/bulk', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function bulkDeleteImages(body: {
  image_ids: number[]
}): Promise<void> {
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

export function fetchUsers(): Promise<ApiUser[]> {
  return request('/users/')
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
  program_id?: number | null
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
    program_id?: number | null
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
  program_id: number | null
}): Promise<ApiUser[]> {
  return request('/users/bulk/program', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// ── Programs ────────────────────────────────────────────

export function fetchPrograms(): Promise<ApiProgram[]> {
  return request('/programs/')
}

export function createProgram(body: { name: string }): Promise<ApiProgram> {
  return request('/programs/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateProgram(
  id: number,
  body: { name: string },
): Promise<ApiProgram> {
  return request(`/programs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteProgram(id: number): Promise<void> {
  return request(`/programs/${id}`, { method: 'DELETE' })
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

// ── Source Images ───────────────────────────────────────

export interface ApiSourceImage {
  id: number
  original_filename: string
  status: string
  error_message: string | null
  name: string | null
  category_id: number | null
  copyright: string | null
  note: string | null
  active: boolean
  program_ids: number[]
  image_id: number | null
  created_at: string
  updated_at: string
}

export async function uploadSourceImage(
  file: File,
  name?: string,
  categoryId?: number | null,
  copyright?: string,
  note?: string,
  programIds?: number[],
  active?: boolean,
  onProgress?: (fraction: number) => void,
): Promise<ApiSourceImage> {
  const form = new FormData()
  form.append('file', file)
  if (name) form.append('name', name)
  if (categoryId != null) form.append('category_id', String(categoryId))
  if (copyright) form.append('copyright', copyright)
  if (note) form.append('note', note)
  if (programIds) {
    for (const id of programIds) {
      form.append('program_ids', String(id))
    }
  }
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
          reject(new Error(`Upload failed: ${xhr.responseText || xhr.statusText}`))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse upload response'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: network error'))
    })

    xhr.send(form)
  })
}

export function fetchSourceImages(): Promise<ApiSourceImage[]> {
  return request('/source-images/')
}

export function fetchSourceImage(id: number): Promise<ApiSourceImage> {
  return request(`/source-images/${id}`)
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
  categoryId: number,
): Promise<ApiBulkImportJob> {
  const form = new FormData()
  for (const file of files) {
    form.append('files', file)
  }
  form.append('category_id', String(categoryId))
  const res = await fetch(`${BASE}/api/admin/bulk-import/`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Bulk import failed: ${text}`)
  }
  return res.json() as Promise<ApiBulkImportJob>
}

export function fetchBulkImportJob(jobId: number): Promise<ApiBulkImportJob> {
  return request(`/admin/bulk-import/${jobId}`)
}

export function fetchBulkImportJobs(): Promise<ApiBulkImportJob[]> {
  return request('/admin/bulk-import/')
}

// ── Issues ──────────────────────────────────────────────

export interface ReportIssueResponse {
  issue_url: string
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

// ── Admin ───────────────────────────────────────────────

export function exportDatabase(): Promise<void> {
  const url = `${BASE}/api/admin/export`
  return fetch(url, { headers: authHeaders() })
    .then((res) => {
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      return res.blob()
    })
    .then((blob) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'corgi-export.json'
      a.click()
      URL.revokeObjectURL(a.href)
    })
}

export interface ImportResult {
  status: string
  imported: { programs?: number; categories: number; images: number; users: number; source_images?: number }
}

export async function importDatabase(file: File): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/admin/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Import failed: ${text}`)
  }
  return res.json() as Promise<ImportResult>
}

// ── Filesystem Snapshots ────────────────────────────────

export async function exportFiles(): Promise<void> {
  // Obtain a short-lived download token so we can hand the URL directly
  // to the browser.  This avoids buffering the entire archive in JS memory
  // (res.blob()) which would crash on multi-GB datasets.
  const tokenRes = await fetch(`${BASE}/api/admin/export-files-token`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!tokenRes.ok) throw new Error(`Failed to obtain download token: ${tokenRes.status}`)
  const { token } = (await tokenRes.json()) as { token: string }

  // Browser-native download — no JS buffering required
  window.location.href = `${BASE}/api/admin/export-files?token=${encodeURIComponent(token)}`
}

export interface FilesImportResult {
  status: string
  restored: { tile_files: number; source_files: number }
}

export async function importFiles(file: File): Promise<FilesImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/admin/import-files`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`File import failed: ${text}`)
  }
  return res.json() as Promise<FilesImportResult>
}
