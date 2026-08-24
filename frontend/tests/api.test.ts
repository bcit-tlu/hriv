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
  setItem: (key: string, val: string) => {
    storage[key] = val
  },
  removeItem: (key: string) => {
    delete storage[key]
  },
  clear: () => {
    for (const key of Object.keys(storage)) delete storage[key]
  },
  get length() {
    return Object.keys(storage).length
  },
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
  ApiTransportError,
  fetchStatus,
  fetchCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchImage,
  fetchImages,
  fetchUncategorizedImages,
  updateImage,
  deleteImage,
  bulkUpdateImages,
  bulkDeleteImages,
  getTileOrder,
  putTileOrder,
  tileOrderConflictCurrent,
  type TileOrderResponse,
  fetchOidcEnabled,
  getOidcLoginUrl,
  fetchUsers,
  loginUser,
  createUser,
  updateUser,
  deleteUser as apiDeleteUser,
  bulkUpdateUserProgram,
  fetchUsersPaged,
  bulkUpdateUserRole,
  bulkDeleteUsers,
  addGroupMembersBulk,
  removeGroupMembersBulk,
  addGroupInstructorsBulk,
  removeGroupInstructorsBulk,
  fetchFilesImportArchives,
  rerunFilesImportArchive,
  deleteFilesImportArchive,
  listExportArchives,
  purgeExportArchive,
  startRebuildTiles,
  getUploadStatus,
  finalizeUpload,
  uploadTaskFile,
  type FilesImportArchive,
  type FilesImportArchiveDeleteResponse,
  type ExportArchive,
  fetchPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  fetchGroupMembers,
  addGroupMember,
  removeGroupMember,
  fetchGroupInstructors,
  addGroupInstructor,
  removeGroupInstructor,
  fetchAnnouncement,
  updateAnnouncement,
  fetchChangelogEntries,
  createChangelogEntry,
  updateChangelogEntry,
  deleteChangelogEntry,
  markChangelogRead,
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
  bulkImportImages,
  replaceImage,
  type ApiCategory,
  type ApiCategoryTree,
  type ApiImage,
  attachedCategoriesFromError,
  type ApiUser,
  type ApiProgram,
  type ApiAnnouncement,
  type ApiChangelogEntry,
  type ApiSourceImage,
  setApiFailureObserver,
  userMessage,
} from '../src/api'

// ── Helpers ──────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

function noContentResponse() {
  return Promise.resolve({
    ok: true,
    status: 204,
    statusText: 'No Content',
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
    text: () => Promise.resolve(''),
  })
}

function errorResponse(status: number, body: string, requestId?: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: body,
    headers: { get: (key: string) => (key === 'X-Request-ID' ? (requestId ?? null) : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body),
  })
}

const CATEGORY_FIXTURE: ApiCategory = {
  id: 1,
  label: 'Architecture',
  parent_id: null,
  program_ids: [],
  group_ids: [],
  status: null,
  sort_order: 0,
  version: 1,
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
  active: true,
  sort_order: 0,
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
  group_ids: [],
  group_names: [],
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

describe('ApiTransportError', () => {
  it('has the transport request context', () => {
    const err = new ApiTransportError('Network error', { method: 'GET', path: '/status' })
    expect(err.name).toBe('ApiTransportError')
    expect(err.method).toBe('GET')
    expect(err.path).toBe('/status')
  })
})

describe('userMessage', () => {
  afterEach(() => {
    setApiFailureObserver(null)
  })

  it('returns friendly message for concurrency-style 409s', () => {
    const err = new ApiError(409, 'Resource has been modified by another client')
    expect(userMessage(err, 'fallback')).toBe(
      'This item was modified by another user. Please refresh and try again.',
    )
  })

  it('returns friendly message for 409s without usable detail', () => {
    const err = new ApiError(409, '')
    expect(userMessage(err, 'fallback')).toBe(
      'This item was modified by another user. Please refresh and try again.',
    )
  })

  it('returns specific detail for 409 conflicts with usable backend messages', () => {
    const err = new ApiError(409, 'Group name already exists')
    expect(userMessage(err, 'fallback')).toBe('Group name already exists')
  })

  it('extracts attached categories from structured 409 details', () => {
    const err = new ApiError(409, 'Group is attached to one or more categories', {
      message: 'Group is attached to one or more categories',
      category_ids: [1, 2],
      categories: [
        { id: 1, label: 'Italian' },
        { id: 2, label: 'Gothic' },
      ],
    })

    expect(attachedCategoriesFromError(err)).toEqual([
      { id: 1, label: 'Italian' },
      { id: 2, label: 'Gothic' },
    ])
  })

  it('returns null for non-structured attached categories errors', () => {
    expect(
      attachedCategoriesFromError(new ApiError(409, 'Group is attached to one or more categories')),
    ).toBeNull()
    expect(attachedCategoriesFromError(new TypeError('nope'))).toBeNull()
  })

  it('returns detail for short 4xx errors', () => {
    const err = new ApiError(422, 'Name already exists')
    expect(userMessage(err, 'fallback')).toBe('Name already exists')
  })

  it('returns a clear message for 413 detail', () => {
    const err = new ApiError(413, '<!DOCTYPE html><html>error page</html>')
    expect(userMessage(err, 'Too large')).toBe('This file is too large to upload.')
  })

  it('returns a clear message for 413 without usable detail', () => {
    const err = new ApiError(413, '')
    expect(userMessage(err, 'Too large')).toBe('This file is too large to upload.')
  })

  it('returns detail for 507 storage errors', () => {
    const err = new ApiError(
      507,
      'Insufficient space to upload archive: required 1 bytes, available 0 bytes',
    )
    expect(userMessage(err, 'fallback')).toBe(
      'Insufficient space to upload archive: required 1 bytes, available 0 bytes',
    )
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

  it('notifies the API failure observer for ApiError values', () => {
    const observer = vi.fn()
    setApiFailureObserver(observer)

    expect(
      userMessage(
        new ApiError(503, 'Backend unavailable', undefined, {
          method: 'GET',
          path: '/images',
          requestId: 'req-123',
        }),
        'fallback',
      ),
    ).toBe('fallback')
    expect(observer).toHaveBeenCalledWith(
      expect.any(ApiError),
      expect.objectContaining({
        method: 'GET',
        path: '/images',
        requestId: 'req-123',
        status: 503,
      }),
    )
  })

  it('notifies the API failure observer for transport errors', () => {
    const observer = vi.fn()
    setApiFailureObserver(observer)

    expect(
      userMessage(
        new ApiTransportError('Network error', { method: 'POST', path: '/images' }),
        'fallback',
      ),
    ).toBe('Network error \u2014 check your connection and try again.')
    expect(observer).toHaveBeenCalledWith(
      expect.any(ApiTransportError),
      expect.objectContaining({
        method: 'POST',
        path: '/images',
      }),
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

  it('returns a clear message for HTML fragment detail on 413', () => {
    expect(userMessage(new ApiError(400, '<div>Service Unavailable</div>'), 'fallback')).toBe(
      'fallback',
    )
    expect(
      userMessage(new ApiError(413, '<h1>413 Request Entity Too Large</h1>'), 'fallback'),
    ).toBe('This file is too large to upload.')
    expect(userMessage(new ApiError(400, '<pre>Error details</pre>'), 'fallback')).toBe('fallback')
    expect(
      userMessage(new ApiError(400, '<table><tr><td>Error</td></tr></table>'), 'fallback'),
    ).toBe('fallback')
  })
})

describe('request helper (via wrapper functions)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('test-jwt')
  })
  afterEach(() => setToken(null))

  it('sends auth + session headers on every request', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]))
    await fetchCategoryTree()

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer test-jwt')
    expect(init.headers['X-Session-ID']).toBeDefined()
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('omits Authorization header when no token is set', async () => {
    setToken(null)
    mockFetch.mockReturnValueOnce(jsonResponse([]))
    await fetchCategoryTree()

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Authorization']).toBeUndefined()
    expect(init.headers['X-Session-ID']).toBeDefined()
  })

  it('throws ApiError on non-OK response', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(403, 'Forbidden'))
    await expect(fetchCategoryTree()).rejects.toThrow(ApiError)
  })

  it('throws ApiError with correct status code', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(422, 'Validation Error', 'req-422'))
    try {
      await fetchCategoryTree()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(422)
      expect((e as ApiError).message).toContain('422')
      expect((e as ApiError).requestId).toBe('req-422')
    }
  })

  it('throws ApiTransportError on fetch network failures', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchCategoryTree()).rejects.toThrow(ApiTransportError)
  })

  it('falls back to statusText when text() rejects', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
        json: () => Promise.reject(new Error('no json')),
        text: () => Promise.reject(new Error('no text')),
      }),
    )
    try {
      await fetchCategoryTree()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(500)
      expect((e as ApiError).message).toContain('Internal Server Error')
    }
  })

  it('surfaces object detail messages from error payloads', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            detail: { message: 'Group is attached to one or more categories', category_ids: [1] },
          }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              detail: {
                message: 'Group is attached to one or more categories',
                category_ids: [1],
              },
            }),
          ),
      }),
    )

    await expect(createGroup({ name: 'New Group' })).rejects.toMatchObject({
      status: 409,
      detail: 'Group is attached to one or more categories',
      data: {
        message: 'Group is attached to one or more categories',
        category_ids: [1],
      },
    })
  })

  it('never surfaces "[object Object]" for structured detail without a message field', async () => {
    const body = JSON.stringify({ detail: { category_ids: [1] } })
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => null },
        json: () => Promise.resolve({ detail: { category_ids: [1] } }),
        text: () => Promise.resolve(body),
      }),
    )

    try {
      await createGroup({ name: 'New Group' })
      expect.unreachable('createGroup should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      const err = e as ApiError
      expect(err.status).toBe(400)
      expect(err.detail).toBe('')
      expect(err.data).toEqual({ category_ids: [1] })
      expect(userMessage(err, 'fallback')).toBe('fallback')
    }
  })

  it('never surfaces "null" for a null detail', async () => {
    const body = JSON.stringify({ detail: null })
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => null },
        json: () => Promise.resolve({ detail: null }),
        text: () => Promise.resolve(body),
      }),
    )

    try {
      await createGroup({ name: 'New Group' })
      expect.unreachable('createGroup should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      const err = e as ApiError
      expect(err.detail).toBe('')
      expect(userMessage(err, 'fallback')).toBe('fallback')
    }
  })
})

// ── Status ───────────────────────────────────────────────────────────────

describe('fetchStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('sends GET to /api/status without auth or Content-Type headers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ maintenance: false, version: '1.0.0' }))
    const result = await fetchStatus()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/status')
    expect(mockFetch.mock.calls[0][1]).toBeUndefined()
    expect(result).toEqual({ maintenance: false, version: '1.0.0' })
  })

  it('throws ApiError on non-OK response', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(503, 'Service Unavailable'))
    await expect(fetchStatus()).rejects.toThrow(ApiError)
  })
})

// ── Categories ───────────────────────────────────────────────────────────

describe('Category API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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

  it('updateCategory sends If-Match header when version is provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(CATEGORY_FIXTURE))
    await updateCategory(1, { label: 'New Label' }, 5)
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['If-Match']).toBe('"5"')
  })

  it('updateCategory omits If-Match header when version is undefined', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(CATEGORY_FIXTURE))
    await updateCategory(1, { label: 'New Label' })
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['If-Match']).toBeUndefined()
  })

  it('deleteCategory sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteCategory(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/categories/1')
    expect(init.method).toBe('DELETE')
  })
})

// ── Images ───────────────────────────────────────────────────────────────

describe('Image API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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
    expect(init.headers['If-Match']).toBe('"3"')
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

// ── Tile order ───────────────────────────────────────────────────────────

describe('Tile order API', () => {
  const TILE_ORDER_FIXTURE: TileOrderResponse = {
    scope: { parent_category_id: 5 },
    revision: 3,
    items: [
      { type: 'category', id: 1, sort_order: 0 },
      { type: 'image', id: 2, sort_order: 1 },
    ],
  }

  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('getTileOrder with a numeric scope appends parent_category_id query param and bypasses cache', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TILE_ORDER_FIXTURE))
    const result = await getTileOrder(5)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tile-order?parent_category_id=5')
    expect(init.cache).toBe('no-store')
    expect(result).toEqual(TILE_ORDER_FIXTURE)
  })

  it('getTileOrder with the root scope sends no query string and bypasses cache', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TILE_ORDER_FIXTURE))
    await getTileOrder(null)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tile-order')
    expect(init.cache).toBe('no-store')
  })

  it('putTileOrder sends PUT with scope, expected_revision, operation_id, and items', async () => {
    // The operation ID travels only in the body; the unused
    // X-Reorder-Operation-Id header was removed in #998.
    mockFetch.mockReturnValueOnce(jsonResponse(TILE_ORDER_FIXTURE))
    await putTileOrder(
      5,
      3,
      [
        { type: 'category', id: 1 },
        { type: 'image', id: 2 },
      ],
      'op-123',
    )
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tile-order')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      scope: { parent_category_id: 5 },
      expected_revision: 3,
      operation_id: 'op-123',
      items: [
        { type: 'category', id: 1 },
        { type: 'image', id: 2 },
      ],
    })
    expect(init.headers?.['X-Reorder-Operation-Id']).toBeUndefined()
  })

  it('putTileOrder without an operationId sends null operation_id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(TILE_ORDER_FIXTURE))
    await putTileOrder(null, 0, [{ type: 'image', id: 9 }])
    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      scope: { parent_category_id: null },
      expected_revision: 0,
      operation_id: null,
      items: [{ type: 'image', id: 9 }],
    })
    expect(init.headers?.['X-Reorder-Operation-Id']).toBeUndefined()
  })

  it('tileOrderConflictCurrent returns the current payload for a 409 ApiError', () => {
    const err = new ApiError(409, 'stale revision', { current: TILE_ORDER_FIXTURE })
    expect(tileOrderConflictCurrent(err)).toEqual(TILE_ORDER_FIXTURE)
  })

  it('tileOrderConflictCurrent returns null for non-409 and non-ApiError values', () => {
    expect(
      tileOrderConflictCurrent(new ApiError(400, 'bad request', { current: TILE_ORDER_FIXTURE })),
    ).toBeNull()
    expect(tileOrderConflictCurrent(new ApiError(409, 'stale revision', {}))).toBeNull()
    expect(tileOrderConflictCurrent(new Error('boom'))).toBeNull()
    expect(tileOrderConflictCurrent(undefined)).toBeNull()
  })
})

// ── OIDC ─────────────────────────────────────────────────────────────────

describe('OIDC API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('fetchUsers sends GET to /api/users/', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([USER_FIXTURE]))
    const result = await fetchUsers()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/users/')
    expect(result).toEqual([USER_FIXTURE])
  })

  it('fetchUsers appends a role query parameter when provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([USER_FIXTURE]))
    await fetchUsers('instructor')
    expect(mockFetch.mock.calls[0][0]).toBe('/api/users/?role=instructor')
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
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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

// ── Groups ───────────────────────────────────────────────────────────────

describe('Group API', () => {
  const GROUP_FIXTURE = {
    id: 1,
    name: 'Cohort A',
    description: null,
    created_by_user_id: 10,
    member_ids: [101],
    instructor_ids: [10],
    created_at: '',
    updated_at: '',
  }
  const MEMBER_FIXTURE = { id: 101, name: 'Alice', email: 'alice@bcit.ca', role: 'student' }

  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('fetchGroups sends GET to /api/groups/', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([GROUP_FIXTURE]))
    const result = await fetchGroups()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/groups/')
    expect(result).toEqual([GROUP_FIXTURE])
  })

  it('createGroup sends POST with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await createGroup({ name: 'Cohort A', description: 'desc' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Cohort A', description: 'desc' })
  })

  it('updateGroup sends PATCH to /api/groups/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await updateGroup(1, { name: 'Renamed' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteGroup sends DELETE to /api/groups/:id', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteGroup(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1')
    expect(init.method).toBe('DELETE')
  })

  it('fetchGroupMembers sends GET to /api/groups/:id/members', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([MEMBER_FIXTURE]))
    const result = await fetchGroupMembers(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/groups/1/members')
    expect(result).toEqual([MEMBER_FIXTURE])
  })

  it('addGroupMember sends POST to /api/groups/:id/members/:userId', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await addGroupMember(1, 101)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1/members/101')
    expect(init.method).toBe('POST')
  })

  it('removeGroupMember sends DELETE to /api/groups/:id/members/:userId', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await removeGroupMember(1, 101)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1/members/101')
    expect(init.method).toBe('DELETE')
  })

  it('fetchGroupInstructors sends GET to /api/groups/:id/instructors', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([MEMBER_FIXTURE]))
    await fetchGroupInstructors(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/groups/1/instructors')
  })

  it('addGroupInstructor sends POST to /api/groups/:id/instructors/:userId', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await addGroupInstructor(1, 10)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1/instructors/10')
    expect(init.method).toBe('POST')
  })

  it('removeGroupInstructor sends DELETE to /api/groups/:id/instructors/:userId', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP_FIXTURE))
    await removeGroupInstructor(1, 10)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/1/instructors/10')
    expect(init.method).toBe('DELETE')
  })
})

// ── Announcement ─────────────────────────────────────────────────────────

describe('Announcement API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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

// ── Changelog ────────────────────────────────────────────────────────────

describe('Changelog API', () => {
  const fixture: ApiChangelogEntry = {
    id: 1,
    title: 'v2.5',
    body: 'Released improvements',
    published_at: '2026-06-16T00:00:00Z',
    created_at: '2026-06-16T00:00:00Z',
    updated_at: '2026-06-16T00:00:00Z',
  }

  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('fetchChangelogEntries sends GET', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([fixture]))
    const result = await fetchChangelogEntries()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/changelog/')
    expect(result).toEqual([fixture])
  })

  it('createChangelogEntry sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(fixture, 201))
    await createChangelogEntry({ title: 'v2.5', body: 'Released improvements' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/changelog/')
    expect(init.method).toBe('POST')
  })

  it('updateChangelogEntry sends PATCH', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(fixture))
    await updateChangelogEntry(1, { title: 'Updated' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/changelog/1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteChangelogEntry sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await deleteChangelogEntry(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/changelog/1')
    expect(init.method).toBe('DELETE')
  })

  it('markChangelogRead sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ changelog_last_read_at: fixture.published_at }))
    await markChangelogRead()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/changelog/mark-read')
    expect(init.method).toBe('POST')
  })
})

// ── Source Images ─────────────────────────────────────────────────────────

describe('Source Image API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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
      image_id: 10,
      file_size: 5000,
      source_checksum: 'a'.repeat(64),
      tile_settings_hash: 'b'.repeat(64),
      tiles_generated_at: '2026-01-01T00:00:00Z',
      tile_cache_status: 'current',
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
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('fetchBulkImportJob sends GET', async () => {
    const fixture = {
      id: 5,
      status: 'completed',
      category_id: 2,
      total_count: 3,
      completed_count: 3,
      failed_count: 0,
      errors: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    mockFetch.mockReturnValueOnce(jsonResponse(fixture))
    const result = await fetchBulkImportJob(5)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/bulk-import/5')
    expect(result).toEqual(fixture)
  })
})

// ── Issues ───────────────────────────────────────────────────────────────

describe('Issue API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('reportIssue sends POST', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        destination: 'github',
        tracking_url: 'https://github.com/...',
        issue_url: 'https://github.com/...',
      }),
    )
    const result = await reportIssue({ description: 'Bug', page_url: 'http://localhost' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/issues/report')
    expect(init.method).toBe('POST')
    expect(result.destination).toBe('github')
    expect(result.tracking_url).toBe('https://github.com/...')
    expect(result.issue_url).toBe('https://github.com/...')
  })
})

// ── Versions ─────────────────────────────────────────────────────────────

describe('Version API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
      }),
    )
    await expect(fetchFrontendVersion()).rejects.toThrow('Frontend /version 404')
  })
})

// ── Download ─────────────────────────────────────────────────────────────

describe('downloadAdminTaskResult', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('fetches download token then navigates to download URL', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ token: 'dl-token-abc' }))

    const originalLocation = window.location
    let assignedHref = ''
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        get href() {
          return assignedHref
        },
        set href(val: string) {
          assignedHref = val
        },
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
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
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
    function MockXHR(this: (typeof xhrInstances)[0]) {
      const listeners: Record<string, (() => void)[]> = {}
      this.open = vi.fn()
      this.send = vi.fn()
      this.abort = vi.fn().mockImplementation(() => {
        for (const cb of listeners['abort'] ?? []) cb()
      })
      this.setRequestHeader = vi.fn()
      this.upload = { addEventListener: vi.fn() }
      this.addEventListener = vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(cb)
      })
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
      setItem: (key: string, val: string) => {
        storage[key] = val
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        for (const key of Object.keys(storage)) delete storage[key]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: (i: number) => Object.keys(storage)[i] ?? null,
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
  })

  it('uploadSourceImage rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const promise = uploadSourceImage(
      file,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ac.signal,
    )
    ac.abort()
    await expect(promise).rejects.toThrow('Upload aborted')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bulkImportImages rejects with AbortError when signal is aborted', async () => {
    const ac = new AbortController()
    const file = new File(['test'], 'test.zip')
    const promise = bulkImportImages(
      [file],
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      ac.signal,
    )
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
    const promise = uploadSourceImage(
      file,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ac.signal,
    )
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
    const promise = uploadSourceImage(
      file,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ac.signal,
    )
    await expect(promise).rejects.toThrow('Upload aborted')
    // Rejects directly without calling xhr.abort() (abort before send
    // doesn't fire the abort event per XHR spec).
    expect(xhrInstances[0].send).not.toHaveBeenCalled()
  })
})

// ── Chunked task-file upload (#125) ──────────────────────────────────────

describe('uploadTaskFile', () => {
  const CHUNK = 10 * 1024 * 1024

  let xhrInstances: Array<{
    open: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    setRequestHeader: ReturnType<typeof vi.fn>
    upload: { addEventListener: ReturnType<typeof vi.fn> }
    addEventListener: ReturnType<typeof vi.fn>
    getResponseHeader: ReturnType<typeof vi.fn>
    status: number
    responseText: string
    listeners: Record<string, (() => void)[]>
  }>

  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
    xhrInstances = []
    // Must use `function` keyword (not arrow) so `new XMLHttpRequest()` works.
    function MockXHR(this: (typeof xhrInstances)[0]) {
      const listeners: Record<string, (() => void)[]> = {}
      this.open = vi.fn()
      this.send = vi.fn()
      this.abort = vi.fn().mockImplementation(() => {
        for (const cb of listeners['abort'] ?? []) cb()
      })
      this.setRequestHeader = vi.fn()
      this.upload = { addEventListener: vi.fn() }
      this.addEventListener = vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(cb)
      })
      this.getResponseHeader = vi.fn().mockReturnValue(null)
      this.status = 200
      this.responseText = '{}'
      this.listeners = listeners
      xhrInstances.push(this)
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR)
  })

  afterEach(() => {
    setToken(null)
    vi.unstubAllGlobals()
    // Re-stub the globals needed by other test blocks
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        for (const key of Object.keys(storage)) delete storage[key]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: (i: number) => Object.keys(storage)[i] ?? null,
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
  })

  const TASK = { id: 3, task_type: 'files_import', status: 'pending' }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  function respond(index: number, status: number, body: string): void {
    const xhr = xhrInstances[index]
    xhr.status = status
    xhr.responseText = body
    for (const cb of xhr.listeners['load'] ?? []) cb()
  }

  function bigFile(size: number): File {
    return new File([new Uint8Array(size)], 'big.tar', { type: 'application/octet-stream' })
  }

  it('uses the single raw PUT fast path for files within one chunk', async () => {
    const file = new File(['abc'], 'small.tar')
    const promise = uploadTaskFile(3, file)
    expect(xhrInstances).toHaveLength(1)
    expect(xhrInstances[0].open).toHaveBeenCalledWith('PUT', '/api/admin/tasks/3/upload')
    respond(0, 200, JSON.stringify(TASK))
    await expect(promise).resolves.toEqual(TASK)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('raw PUT path rejects with ApiError on server failure', async () => {
    const file = new File(['abc'], 'small.tar')
    const promise = uploadTaskFile(3, file)
    respond(0, 500, JSON.stringify({ detail: 'disk full' }))
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).detail).toBe('disk full')
  })

  it('uploads a large file in sequential PATCH chunks and finalizes', async () => {
    const file = bigFile(CHUNK + 5)
    // resync → GET upload status, then finalize → POST
    mockFetch.mockReturnValueOnce(jsonResponse({ bytes_received: 0, status: 'uploading' }))
    mockFetch.mockReturnValueOnce(jsonResponse(TASK))
    const promise = uploadTaskFile(3, file)
    await flush()
    expect(xhrInstances).toHaveLength(1)
    expect(xhrInstances[0].open).toHaveBeenCalledWith('PATCH', '/api/admin/tasks/3/upload')
    expect(xhrInstances[0].setRequestHeader).toHaveBeenCalledWith('Upload-Offset', '0')
    expect(xhrInstances[0].setRequestHeader).toHaveBeenCalledWith(
      'Upload-Length',
      String(file.size),
    )
    respond(0, 200, JSON.stringify({ bytes_received: CHUNK, status: 'uploading' }))
    await flush()
    expect(xhrInstances).toHaveLength(2)
    expect(xhrInstances[1].setRequestHeader).toHaveBeenCalledWith('Upload-Offset', String(CHUNK))
    respond(1, 200, JSON.stringify({ bytes_received: file.size, status: 'uploading' }))
    await expect(promise).resolves.toEqual(TASK)
    const finalizeCall = mockFetch.mock.calls[1]
    expect(finalizeCall[0]).toBe('/api/admin/tasks/3/upload/finalize')
    expect(JSON.parse(finalizeCall[1].body)).toEqual({ total_bytes: file.size })
  })

  it('resumes from the server-reported offset on a 409 offset conflict', async () => {
    const file = bigFile(CHUNK + 5)
    mockFetch.mockReturnValueOnce(jsonResponse({ bytes_received: 0, status: 'uploading' }))
    mockFetch.mockReturnValueOnce(jsonResponse(TASK))
    const promise = uploadTaskFile(3, file)
    await flush()
    // Server already has the first chunk: conflict carries the real offset.
    respond(0, 409, JSON.stringify({ detail: { bytes_received: CHUNK, status: 'uploading' } }))
    await flush()
    expect(xhrInstances).toHaveLength(2)
    expect(xhrInstances[1].setRequestHeader).toHaveBeenCalledWith('Upload-Offset', String(CHUNK))
    respond(1, 200, JSON.stringify({ bytes_received: file.size, status: 'uploading' }))
    await expect(promise).resolves.toEqual(TASK)
  })

  it('rejects when the task is not in uploading state at resync', async () => {
    const file = bigFile(CHUNK + 5)
    mockFetch.mockReturnValueOnce(jsonResponse({ bytes_received: 0, status: 'processing' }))
    const err = await uploadTaskFile(3, file).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).detail).toContain("'processing'")
    expect(xhrInstances).toHaveLength(0)
  })

  it('rejects when a 409 chunk conflict reports a non-uploading task state', async () => {
    const file = bigFile(CHUNK + 5)
    mockFetch.mockReturnValueOnce(jsonResponse({ bytes_received: 0, status: 'uploading' }))
    const promise = uploadTaskFile(3, file)
    await flush()
    respond(0, 409, JSON.stringify({ detail: { bytes_received: CHUNK, status: 'cancelled' } }))
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).detail).toContain("'cancelled'")
  })

  it('rejects immediately when the signal is already aborted (chunked path)', async () => {
    const ac = new AbortController()
    ac.abort()
    const promise = uploadTaskFile(3, bigFile(CHUNK + 5), undefined, ac.signal)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(xhrInstances).toHaveLength(0)
  })
})

// ── Paginated users (#125) ───────────────────────────────────────────────

describe('fetchUsersPaged', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  function pagedResponse(items: unknown[], totalHeader: string | null) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (key: string) => (key === 'X-Total-Count' ? totalHeader : null) },
      json: () => Promise.resolve(items),
      text: () => Promise.resolve(JSON.stringify(items)),
    })
  }

  it('builds the query string from all params and reads X-Total-Count', async () => {
    mockFetch.mockReturnValueOnce(pagedResponse([USER_FIXTURE], '42'))
    const result = await fetchUsersPaged({
      role: 'student',
      programIds: [1, 2],
      q: '  smith  ',
      page: 3,
      pageSize: 25,
    })
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(
      '/api/users/?role=student&program_id=1&program_id=2&q=smith&page=3&page_size=25',
    )
    expect(result).toEqual({ items: [USER_FIXTURE], total: 42 })
  })

  it('omits the query string entirely when no params are set', async () => {
    mockFetch.mockReturnValueOnce(pagedResponse([], null))
    const result = await fetchUsersPaged({})
    expect(mockFetch.mock.calls[0][0]).toBe('/api/users/')
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('falls back to the item count when X-Total-Count is absent', async () => {
    mockFetch.mockReturnValueOnce(pagedResponse([USER_FIXTURE, USER_FIXTURE], null))
    const result = await fetchUsersPaged({ page: 1 })
    expect(result.total).toBe(2)
  })

  it('ignores a blank q filter', async () => {
    mockFetch.mockReturnValueOnce(pagedResponse([], null))
    await fetchUsersPaged({ q: '   ' })
    expect(mockFetch.mock.calls[0][0]).toBe('/api/users/')
  })

  it('throws ApiError with parsed detail on failure', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(403, JSON.stringify({ detail: 'Forbidden' })))
    const err = await fetchUsersPaged({ role: 'student' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).detail).toBe('Forbidden')
  })
})

// ── Bulk user operations (#125) ──────────────────────────────────────────

describe('Bulk user API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('bulkUpdateUserRole sends PATCH to /api/users/bulk/role', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([USER_FIXTURE]))
    await bulkUpdateUserRole({ user_ids: [1, 2], role: 'instructor' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/bulk/role')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [1, 2], role: 'instructor' })
  })

  it('bulkDeleteUsers sends DELETE to /api/users/bulk', async () => {
    mockFetch.mockReturnValueOnce(noContentResponse())
    await bulkDeleteUsers({ user_ids: [1, 2, 3] })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users/bulk')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [1, 2, 3] })
  })
})

// ── Bulk group membership operations (#125) ──────────────────────────────

describe('Bulk group membership API', () => {
  const GROUP = { id: 7, name: 'Cohort A', description: null }

  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('addGroupMembersBulk sends POST to /groups/:id/members/bulk', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP))
    await addGroupMembersBulk(7, [1, 2])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/7/members/bulk')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [1, 2] })
  })

  it('removeGroupMembersBulk sends DELETE to /groups/:id/members/bulk', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP))
    await removeGroupMembersBulk(7, [3])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/7/members/bulk')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [3] })
  })

  it('addGroupInstructorsBulk sends POST to /groups/:id/instructors/bulk', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP))
    await addGroupInstructorsBulk(7, [4, 5])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/7/instructors/bulk')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [4, 5] })
  })

  it('removeGroupInstructorsBulk sends DELETE to /groups/:id/instructors/bulk', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(GROUP))
    await removeGroupInstructorsBulk(7, [6])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/groups/7/instructors/bulk')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ user_ids: [6] })
  })
})

// ── Admin archive management (#125) ──────────────────────────────────────

describe('Admin archive API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  const ARCHIVE: FilesImportArchive = {
    archive_task_id: 9,
    original_filename: 'import.tar.gz',
    size_bytes: 1024,
    created_at: '2026-01-01T00:00:00Z',
    last_status: 'completed',
  }

  const EXPORT_ARCHIVE: ExportArchive = {
    task_id: 5,
    task_type: 'files_export',
    artifact_role: 'result',
    filename: 'export.tar.gz',
    size_bytes: 2048,
    status: 'completed',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:01:00Z',
    purgeable: true,
  }

  it('fetchFilesImportArchives sends GET to the archives listing', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([ARCHIVE]))
    const result = await fetchFilesImportArchives()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/tasks/files-import/archives')
    expect(result).toEqual([ARCHIVE])
  })

  it('rerunFilesImportArchive sends POST with the archive task id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 10, status: 'pending' }))
    await rerunFilesImportArchive(9)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/files-import/rerun')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ archive_task_id: 9 })
  })

  it('deleteFilesImportArchive sends DELETE to the archive path', async () => {
    const resp: FilesImportArchiveDeleteResponse = {
      archive_task_id: 9,
      deleted: true,
      path: '/data/import-archives/9.tar.gz',
    }
    mockFetch.mockReturnValueOnce(jsonResponse(resp))
    const result = await deleteFilesImportArchive(9)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/files-import/archives/9')
    expect(init.method).toBe('DELETE')
    expect(result).toEqual(resp)
  })

  it('listExportArchives sends GET to /admin/tasks/backup-archives', async () => {
    const resp = { archives: [EXPORT_ARCHIVE], total_size_bytes: 2048 }
    mockFetch.mockReturnValueOnce(jsonResponse(resp))
    const result = await listExportArchives()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/tasks/backup-archives')
    expect(result).toEqual(resp)
  })

  it('purgeExportArchive sends DELETE to the archive artifact path', async () => {
    const resp = { deleted: true, task_id: 5, artifact_role: 'result', size_bytes: 100 }
    mockFetch.mockReturnValueOnce(jsonResponse(resp))
    const result = await purgeExportArchive(5, 'result')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/backup-archives/5/result')
    expect(init.method).toBe('DELETE')
    expect(result).toEqual(resp)
  })

  it('startRebuildTiles defaults to the missing_stale scope', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 11, status: 'pending' }))
    await startRebuildTiles()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/rebuild-tiles')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ scope: 'missing_stale' })
  })

  it('startRebuildTiles forwards an explicit scope and image ids', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 12, status: 'pending' }))
    await startRebuildTiles({ scope: 'all', image_ids: [1, 2] })
    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ scope: 'all', image_ids: [1, 2] })
  })
})

// ── Chunked upload status helpers (#125) ─────────────────────────────────

describe('Upload status API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    setToken('jwt')
  })
  afterEach(() => setToken(null))

  it('getUploadStatus sends GET to /admin/tasks/:id/upload', async () => {
    const resp = { bytes_received: 2048, status: 'uploading' }
    mockFetch.mockReturnValueOnce(jsonResponse(resp))
    const result = await getUploadStatus(3)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/tasks/3/upload')
    expect(result).toEqual(resp)
  })

  it('finalizeUpload sends POST with the total byte count', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 3, status: 'pending' }))
    await finalizeUpload(3, 4096)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/admin/tasks/3/upload/finalize')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ total_bytes: 4096 })
  })
})
