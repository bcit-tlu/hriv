/**
 * Unit tests for the core api.ts module — covers the generic request helper,
 * token management, ApiError, and every thin wrapper function not already
 * covered by adminTaskApi.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock fetch globally ──────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Stub localStorage
const storage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, val: string) => { storage[key] = val },
  removeItem: (key: string) => { delete storage[key] },
  get length() { return Object.keys(storage).length },
  key: (i: number) => Object.keys(storage)[i] ?? null,
})

// Stub crypto.randomUUID (SESSION_ID is captured at module load, so this
// must be stubbed before the import — Vitest hoists stubGlobal).
vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })

import {
  setToken,
  getToken,
  clearUserStorage,
  ApiError,
  fetchStatus,
  fetchCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  fetchImage,
  fetchImages,
  fetchUncategorizedImages,
  updateImage,
  deleteImage,
  bulkUpdateImages,
  bulkDeleteImages,
  fetchOidcEnabled,
  getOidcLoginUrl,
  fetchUsers,
  loginUser,
  createUser,
  updateUser,
  deleteUser as apiDeleteUser,
  bulkUpdateUserProgram,
  fetchPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  fetchAnnouncement,
  updateAnnouncement,
  fetchSourceImage,
  fetchBulkImportJob,
  reportIssue,
  fetchVersions,
  fetchFrontendVersion,
  downloadAdminTaskResult,
  startDbExport,
  startFilesExport,
  initFilesImport,
  fetchAdminTasks,
  fetchAdminTask,
  cancelAdminTask,
  uploadSourceImage,
  uploadTaskFile,
  bulkImportImages,
  replaceImage,
  type ApiCategory,
  type ApiCategoryTree,
  type ApiImage,
  type ApiUser,
  type ApiProgram,
  type ApiAnnouncement,
  type ApiSourceImage,
  userMessage,
} from '../src/api'

// ── Helpers ──────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

function noContentResponse() {
  return Promise.resolve({
    ok: true,
    status: 204,
    statusText: 'No Content',
    json: () => Promise.reject(new Error('no body')),
    text: () => Promise.resolve(''),
  })
}

function errorResponse(status: number, body: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: body,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body),
  })
}

const CATEGORY_FIXTURE: ApiCategory = {
  id: 1,
  label: 'Architecture',
  parent_id: null,
  program_ids: [],
  status: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const TREE_FIXTURE: ApiCategoryTree = {
  ...CATEGORY_FIXTURE,
  children: [],
  images: [],
}

const IMAGE_FIXTURE: ApiImage = {
  id: 1,
  name: 'test.jpg',
  thumb: '/thumb/1.jpg',
  tile_sources: '/tiles/1',
  category_id: 1,
  copyright: null,
  note: null,
  program_ids: [],
  active: true,
  metadata_extra: null,
  version: 1,
  width: 100,
  height: 100,
  file_size: 1024,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const USER_FIXTURE: ApiUser = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.ca',
  role: 'admin',
  program_ids: [],
  program_names: [],
  last_access: null,
  metadata_extra: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const PROGRAM_FIXTURE: ApiProgram = {
  id: 1,
  name: 'Medical Lab',
  oidc_group: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const ANNOUNCEMENT_FIXTURE: ApiAnnouncement = {
  id: 1,
  message: 'System update tonight',
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Token management', () => {
  afterEach(() => setToken(null))

  it('setToken stores and getToken retrieves', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
    expect(storage['hriv_token']).toBe('abc123')
  })

  it('setToken(null) clears the token', () => {
    setToken('abc123')
    setToken(null)
    expect(getToken()).toBeNull()
    expect(storage['hriv_token']).toBeUndefined()
  })

  it('clearUserStorage removes all hriv_ and hriv- keys', () => {
    storage['hriv_token'] = 'jwt'
    storage['hriv_user'] = '{"id":1}'
    storage['hriv-color-mode'] = 'dark'
    storage['other-app-key'] = 'keep-me'
    setToken('jwt')

    clearUserStorage()

    expect(getToken()).toBeNull()
    expect(storage['hriv_token']).toBeUndefined()
    expect(storage['hriv_user']).toBeUndefined()
    expect(storage['hriv-color-mode']).toBeUndefined()
    expect(storage['other-app-key']).toBe('keep-me')
  })
})

describe('ApiError', () => {
  it('has correct status and message', () => {
    const err = new ApiError(404, 'Not Found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('API 404: Not Found')
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('userMessage', () => {
  it('returns conflict message for 409', () => {
    const err = new ApiError(409, 'Conflict')
    expect(userMessage(err, 'fallback')).toBe(
      'This item was modified by another user. Please refresh and try again.',
    )
  })

  it('returns detail for short 4xx errors', () => {
    const err = new ApiError(422, 'Name already exists')
    expect(userMessage(err, 'fallback')).toBe('Name already exists')
  })

  it('returns fallback for HTML detail', () => {
    const err = new ApiError(413, '<!DOCTYPE html><html>error page</html>')
    expect(userMessage(err, 'Too large')).toBe('Too large')
  })

  it('returns fallback for detail exceeding 200 chars', () => {
    const err = new ApiError(400, 'x'.repeat(201))
    expect(userMessage(err, 'fallback')).toBe('fallback')
  })

  it('returns fallback for empty detail', () => {
    const err = new ApiError(400, '')
    expect(userMessage(err, 'fallback')).toBe('fallback')
  })

  it('returns fallback for whitespace-only detail', () => {
    const err = new ApiError(400, '   ')
    expect(userMessage(err, 'fallback')).toBe('fallback')
  })

  it('returns fallback for 5xx errors', () => {
    const err = new ApiError(500, 'Internal Server Error')
    expect(userMessage(err, 'fallback')).toBe('fallback')
  })

  it('returns network message for TypeError', () => {
    expect(userMessage(new TypeError('Failed to fetch'), 'fallback')).toBe(
      'Network error \u2014 check your connection and try again.',
    )
  })

  it('returns fallback for AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError')
    expect(userMessage(err, 'fallback')).toBe('fallback')
  })

  it('returns fallback for unknown error types', () => {
    expect(userMessage('unexpected', 'fallback')).toBe('fallback')
    expect(userMessage(42, 'fallback')).toBe('fallback')
    expect(userMessage(null, 'fallback')).toBe('fallback')
  })

  it('returns fallback for HTML fragment detail', () => {
    expect(userMessage(new ApiError(400, '<div>Service Unavailable</div>'), 'fallback')).toBe('fallback')
    expect(userMessage(new ApiError(413, '<h1>413 Request Entity Too Large</h1>'), 'fallback')).toBe('fallback')
    expect(userMessage(new ApiError(400, '<pre>Error details</pre>'), 'fallback')).toBe('fallback')
    expect(userMessage(new ApiError(400, '<table><tr><td>Error</td></tr></table>'), 'fallback')).toBe('fallback')
  })
})

describe('request helper (via wrapper functions)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('test-jwt')
  })
  afterEach(() => setToken(null))

  it('sends auth + session headers on every request', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ maintenance: false, version: '1.0' }))
    await fetchStatus()

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer test-jwt')
    expect(init.headers['X-Session-ID']).toBeDefined()
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('omits Authorization header when no token is set', async () => {
    setToken(null)
    mockFetch.mockReturnValueOnce(jsonResponse({ maintenance: false, version: '1.0' }))
    await fetchStatus()

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Authorization']).toBeUndefined()
    expect(init.headers['X-Session-ID']).toBeDefined()
  })

  it('throws ApiError on non-OK response', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(403, 'Forbidden'))
    await expect(fetchStatus()).rejects.toThrow(ApiError)
  })

  it('throws ApiError with correct status code', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(422, 'Validation Error'))
    try {
      await fetchStatus()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(422)
      expect((e as ApiError).message).toContain('422')
    }
  })

  it('falls back to statusText when text() rejects', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('no json')),
        text: () => Promise.reject(new Error('no text')),
      }),
    )
    try {
      await fetchStatus()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(500)
      expect((e as ApiError).message).toContain('Internal Server Error')
    }
  })
})

// ── Status ───────────────────────────────────────────────────────────────

describe('fetchStatus', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('sends GET to /api/status', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ maintenance: false, version: '1.0.0' }))
    const result = await fetchStatus()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/status')
    expect(result).toEqual({ maintenance: false, version: '1.0.0' })
  })
})

// ── Categories ───────────────────────────────────────────────────────────

describe('Category API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchCategoryTree sends GET to /api/categories/tree', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([TREE_FIXTURE]))
    const result = await fetchCategoryTree()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/categories/tree')
    expect(result).toEqual([TREE_FIXTURE])
  })

  it('createCategory sends POST with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(CATEGORY_FIXTURE))
    const result = await createCategory({ label: 'Architecture' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/categories/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ label: 'Architecture' })
    expect(result).toEqual(CATEGORY_FIXTURE)
  })

  it('updateCategory sends PATCH with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(CATEGORY_FIXTURE))
    await updateCategory(1, { label: 'New Label' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/categories/1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ label: 'New Label' })
  })

  it('deleteCategory sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteCategory(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/categories/1')
    expect(init.method).toBe('DELETE')
  })

  it('reorderCategories sends PUT with items array', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await reorderCategories([{ id: 1, parent_id: null, sort_order: 0 }])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/categories/reorder')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      items: [{ id: 1, parent_id: null, sort_order: 0 }],
    })
  })
})

// ── Images ───────────────────────────────────────────────────────────────

describe('Image API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchImage sends GET to /api/images/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(IMAGE_FIXTURE))
    const result = await fetchImage(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/images/1')
    expect(result).toEqual(IMAGE_FIXTURE)
  })

  it('fetchImages without category sends GET to /api/images/', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([IMAGE_FIXTURE]))
    await fetchImages()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/images/')
  })

  it('fetchImages with category appends query param', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([IMAGE_FIXTURE]))
    await fetchImages(5)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/images/?category_id=5')
  })

  it('fetchUncategorizedImages sends correct query', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]))
    await fetchUncategorizedImages()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/images/?uncategorized=true')
  })

  it('updateImage sends PATCH with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(IMAGE_FIXTURE))
    await updateImage(1, { name: 'renamed.jpg' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/images/1')
    expect(init.method).toBe('PATCH')
  })

  it('updateImage sends If-Match header when version is provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(IMAGE_FIXTURE))
    await updateImage(1, { name: 'renamed.jpg' }, 3)
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['If-Match']).toBe('3')
  })

  it('updateImage omits If-Match header when version is undefined', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(IMAGE_FIXTURE))
    await updateImage(1, { name: 'renamed.jpg' })
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['If-Match']).toBeUndefined()
  })

  it('deleteImage sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteImage(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/images/1')
    expect(init.method).toBe('DELETE')
  })

  it('bulkUpdateImages sends PATCH to /api/images/bulk', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([IMAGE_FIXTURE]))
    await bulkUpdateImages({ image_ids: [1, 2], active: false })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/images/bulk')
    expect(init.method).toBe('PATCH')
  })

  it('bulkDeleteImages sends DELETE to /api/images/bulk', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await bulkDeleteImages({ image_ids: [1, 2] })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/images/bulk')
    expect(init.method).toBe('DELETE')
  })
})

// ── OIDC ─────────────────────────────────────────────────────────────────

describe('OIDC API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchOidcEnabled sends GET to /api/auth/oidc/enabled', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ enabled: true }))
    const result = await fetchOidcEnabled()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/auth/oidc/enabled')
    expect(result).toEqual({ enabled: true })
  })

  it('getOidcLoginUrl returns the login endpoint URL', () => {
    expect(getOidcLoginUrl()).toBe('/api/auth/oidc/login')
  })
})

// ── Users ────────────────────────────────────────────────────────────────

describe('User API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchUsers sends GET to /api/users/', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([USER_FIXTURE]))
    const result = await fetchUsers()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/users/')
    expect(result).toEqual([USER_FIXTURE])
  })

  it('loginUser sends POST with credentials', async () => {
    const loginResp = { access_token: 'tok', token_type: 'bearer', user: USER_FIXTURE }
    mockFetch.mockReturnValueOnce(jsonResponse(loginResp))
    const result = await loginUser('admin@example.ca', 'password')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ email: 'admin@example.ca', password: 'password' })
    expect(result).toEqual(loginResp)
  })

  it('createUser sends POST to /api/users/', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(USER_FIXTURE))
    await createUser({ name: 'Test', email: 'test@example.ca', role: 'student', password: 'pw' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/')
    expect(init.method).toBe('POST')
  })

  it('updateUser sends PATCH to /api/users/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(USER_FIXTURE))
    await updateUser(1, { name: 'Updated' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteUser sends DELETE to /api/users/:id', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await apiDeleteUser(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/1')
    expect(init.method).toBe('DELETE')
  })

  it('bulkUpdateUserProgram sends PATCH to /api/users/bulk/program', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([USER_FIXTURE]))
    await bulkUpdateUserProgram({ user_ids: [1, 2], program_ids: [3] })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/bulk/program')
    expect(init.method).toBe('PATCH')
  })
})

// ── Programs ─────────────────────────────────────────────────────────────

describe('Program API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchPrograms sends GET', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([PROGRAM_FIXTURE]))
    const result = await fetchPrograms()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/programs/')
    expect(result).toEqual([PROGRAM_FIXTURE])
  })

  it('createProgram sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(PROGRAM_FIXTURE))
    await createProgram({ name: 'Medical Lab' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/programs/')
    expect(init.method).toBe('POST')
  })

  it('updateProgram sends PATCH', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(PROGRAM_FIXTURE))
    await updateProgram(1, { name: 'Updated' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/programs/1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteProgram sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteProgram(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/programs/1')
    expect(init.method).toBe('DELETE')
  })
})

// ── Announcement ─────────────────────────────────────────────────────────

describe('Announcement API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchAnnouncement sends GET', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(ANNOUNCEMENT_FIXTURE))
    const result = await fetchAnnouncement()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/announcement/')
    expect(result).toEqual(ANNOUNCEMENT_FIXTURE)
  })

  it('updateAnnouncement sends PUT', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(ANNOUNCEMENT_FIXTURE))
    await updateAnnouncement({ message: 'Updated', enabled: false })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/announcement/')
    expect(init.method).toBe('PUT')
  })
})

// ── Source Images ─────────────────────────────────────────────────────────

describe('Source Image API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchSourceImage sends GET', async () => {
    const fixture: ApiSourceImage = {
      id: 1,
      original_filename: 'test.tiff',
      status: 'completed',
      progress: 100,
      error_message: null,
      status_message: null,
      name: 'test',
      category_id: 1,
      copyright: null,
      note: null,
      active: true,
      program_ids: [],
      image_id: 10,
      file_size: 5000,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    mockFetch.mockReturnValueOnce(jsonResponse(fixture))
    const result = await fetchSourceImage(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/source-images/1')
    expect(result).toEqual(fixture)
  })
})

// ── Bulk Import ──────────────────────────────────────────────────────────

describe('Bulk Import API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchBulkImportJob sends GET', async () => {
    const fixture = { id: 5, status: 'completed', category_id: 2, total_count: 3, completed_count: 3, failed_count: 0, errors: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
    mockFetch.mockReturnValueOnce(jsonResponse(fixture))
    const result = await fetchBulkImportJob(5)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/bulk-import/5')
    expect(result).toEqual(fixture)
  })
})

// ── Issues ───────────────────────────────────────────────────────────────

describe('Issue API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('reportIssue sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ issue_url: 'https://github.com/...' }))
    const result = await reportIssue({ description: 'Bug', page_url: 'http://localhost' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/issues/report')
    expect(init.method).toBe('POST')
    expect(result.issue_url).toBe('https://github.com/...')
  })
})

// ── Versions ─────────────────────────────────────────────────────────────

describe('Version API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetchVersions sends GET to /api/admin/version', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ backend: '1.0.0', backup: '1.0.0' }))
    const result = await fetchVersions()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/version')
    expect(result).toEqual({ backend: '1.0.0', backup: '1.0.0' })
  })

  it('fetchFrontendVersion sends GET to /version (not /api/version)', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ frontend: '1.0.0' }))
    const result = await fetchFrontendVersion()
    // Should use absolute /version, not BASE-prefixed
    expect(mockFetch.mock.calls[0][0]).toBe('/version')
    expect(result).toEqual({ frontend: '1.0.0' })
  })

  it('fetchFrontendVersion throws on non-OK response', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' }),
    )
    await expect(fetchFrontendVersion()).rejects.toThrow('Frontend /version 404')
  })
})

// ── Download ─────────────────────────────────────────────────────────────

describe('downloadAdminTaskResult', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  it('fetches download token then navigates to download URL', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ token: 'dl-token-abc' }))

    const originalLocation = window.location
    let assignedHref = ''
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        get href() { return assignedHref },
        set href(val: string) { assignedHref = val },
      },
      writable: true,
      configurable: true,
    })

    try {
      await downloadAdminTaskResult(42)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/42/download-token')
      expect(init.method).toBe('POST')
      expect(assignedHref).toBe('/api/admin/tasks/42/download?token=dl-token-abc')
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      })
    }
  })
})

// ── Admin Tasks ──────────────────────────────────────────────────────────

describe('Admin Tasks API', () => {
  beforeEach(() => { mockFetch.mockReset(); setToken('jwt') })
  afterEach(() => setToken(null))

  const TASK_FIXTURE = {
    id: 1,
    task_type: 'db_export',
    status: 'completed',
    progress: 100,
    log: '',
    result_filename: 'export.json',
    error_message: null,
    created_by: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:01:00Z',
  }

  it('startDbExport sends POST to /admin/tasks/db-export', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))
    const result = await startDbExport()
    expect(result).toEqual(TASK_FIXTURE)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/db-export')
    expect(init.method).toBe('POST')
  })

  it('startFilesExport sends POST to /admin/tasks/files-export', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))
    const result = await startFilesExport()
    expect(result).toEqual(TASK_FIXTURE)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/files-export')
    expect(init.method).toBe('POST')
  })

  it('initFilesImport sends POST with filename query param', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))
    const result = await initFilesImport('archive.tar.gz')
    expect(result).toEqual(TASK_FIXTURE)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/files-import?filename=archive.tar.gz')
  })

  it('fetchAdminTasks sends GET to /admin/tasks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([TASK_FIXTURE]))
    const result = await fetchAdminTasks()
    expect(result).toEqual([TASK_FIXTURE])
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/tasks')
  })

  it('fetchAdminTask sends GET to /admin/tasks/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))
    const result = await fetchAdminTask(42)
    expect(result).toEqual(TASK_FIXTURE)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/tasks/42')
  })

  it('cancelAdminTask sends POST to /admin/tasks/:id/cancel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ...TASK_FIXTURE, status: 'cancelled' }))
    const result = await cancelAdminTask(42)
    expect(result.status).toBe('cancelled')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/42/cancel')
    expect(init.method).toBe('POST')
  })
})

// ── XHR upload abort tests (#266, #295) ──────────────────────────────────

describe('XHR upload abort support', () => {
  let xhrInstances: Array<{
    open: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    setRequestHeader: ReturnType<typeof vi.fn>
    upload: { addEventListener: ReturnType<typeof vi.fn> }
    addEventListener: ReturnType<typeof vi.fn>
    status: number
    responseText: string
    listeners: Record<string, (() => void)[]>
  }>

  beforeEach(() => {
    xhrInstances = []
    // Must use `function` keyword (not arrow) so `new XMLHttpRequest()` works.
    function MockXHR(this: typeof xhrInstances[0]) {
      const listeners: Record<string, (() => void)[]> = {}
      this.open = vi.fn()
      this.send = vi.fn()
      this.abort = vi.fn().mockImplementation(() => {
        for (const cb of listeners['abort'] ?? []) cb()
      })
      this.setRequestHeader = vi.fn()
      this.upload = { addEventListener: vi.fn() }
      this.addEventListener = vi.fn().mockImplementation(
        (event: string, cb: () => void) => {
          if (!listeners[event]) listeners[event] = []
          listeners[event].push(cb)
        },
      )
      this.status = 200
      this.responseText = '{}'
      this.listeners = listeners
      xhrInstances.push(this)
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // Re-stub the globals needed by other test blocks
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => { storage[key] = val },
      removeItem: (key: string) => { delete storage[key] },
      get length() { return Object.keys(storage).length },
      key: (i: number) => Object.keys(storage)[i] ?? null,
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
  })

  it('uploadSourceImage rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const promise = uploadSourceImage(file, undefined, undefined, undefined, undefined, undefined, undefined, ac.signal)
    ac.abort()
    await expect(promise).rejects.toThrow('Upload aborted')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uploadTaskFile rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.tar.gz')
    const promise = uploadTaskFile(1, file, undefined, ac.signal)
    ac.abort()
    await expect(promise).rejects.toThrow('Upload aborted')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bulkImportImages rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.zip')
    const promise = bulkImportImages([file], 1, undefined, undefined, undefined, undefined, ac.signal)
    ac.abort()
    await expect(promise).rejects.toThrow('Upload aborted')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('replaceImage rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const promise = replaceImage(1, file, undefined, ac.signal)
    ac.abort()
    await expect(promise).rejects.toThrow('Upload aborted')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uploadSourceImage calls xhr.abort() when signal fires', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const promise = uploadSourceImage(file, undefined, undefined, undefined, undefined, undefined, undefined, ac.signal)
    expect(xhrInstances).toHaveLength(1)
    ac.abort()
    expect(xhrInstances[0].abort).toHaveBeenCalled()
    await expect(promise).rejects.toThrow()
  })

  it('does not abort when no signal is passed', () => {
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    uploadSourceImage(file)
    expect(xhrInstances).toHaveLength(1)
    expect(xhrInstances[0].abort).not.toHaveBeenCalled()
  })

  it('rejects immediately when signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const promise = uploadSourceImage(file, undefined, undefined, undefined, undefined, undefined, undefined, ac.signal)
    await expect(promise).rejects.toThrow('Upload aborted')
    // Rejects directly without calling xhr.abort() (abort before send
    // doesn't fire the abort event per XHR spec).
    expect(xhrInstances[0].send).not.toHaveBeenCalled()
  })
})
