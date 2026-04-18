/**
 * Unit tests for the background admin task API functions in api.ts.
 *
 * Covers:
 * - startDbExport / startFilesExport (simple POST via request helper)
 * - startDbImport / startFilesImport (FormData POST with file upload)
 * - fetchAdminTasks / fetchAdminTask (GET requests)
 * - cancelAdminTask (POST with task ID)
 * - downloadAdminTaskResult (token fetch + navigation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock fetch globally ──────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Stub localStorage for token management
const storage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, val: string) => { storage[key] = val },
  removeItem: (key: string) => { delete storage[key] },
})

// Stub crypto.randomUUID (used for SESSION_ID)
vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })

import {
  startDbExport,
  startDbImport,
  startFilesExport,
  startFilesImport,
  fetchAdminTasks,
  fetchAdminTask,
  cancelAdminTask,
  downloadAdminTaskResult,
  setToken,
  type AdminTask,
} from '../src/api'

// ── Helpers ──────────────────────────────────────────────────────────────

const TASK_FIXTURE: AdminTask = {
  id: 1,
  task_type: 'db_export',
  status: 'pending',
  progress: 0,
  log: '',
  result_filename: null,
  error_message: null,
  created_by: 1,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
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

// ── Tests ────────────────────────────────────────────────────────────────

describe('Background Admin Task API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setToken('test-jwt-token')
  })

  afterEach(() => {
    setToken(null)
  })

  // ── startDbExport ────────────────────────────────────────────────────

  describe('startDbExport', () => {
    it('sends POST to /api/admin/tasks/db-export with auth headers', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const result = await startDbExport()

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/db-export')
      expect(init.method).toBe('POST')
      expect(init.headers['Authorization']).toBe('Bearer test-jwt-token')
      expect(init.headers['X-Session-ID']).toBeDefined()
      expect(result).toEqual(TASK_FIXTURE)
    })

    it('throws on non-OK response', async () => {
      mockFetch.mockReturnValueOnce(errorResponse(500, 'Internal Server Error'))

      await expect(startDbExport()).rejects.toThrow('API 500')
    })
  })

  // ── startFilesExport ─────────────────────────────────────────────────

  describe('startFilesExport', () => {
    it('sends POST to /api/admin/tasks/files-export', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const result = await startFilesExport()

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/files-export')
      expect(init.method).toBe('POST')
      expect(result).toEqual(TASK_FIXTURE)
    })
  })

  // ── startDbImport ────────────────────────────────────────────────────

  describe('startDbImport', () => {
    it('sends POST with FormData containing file', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const file = new File(['{}'], 'dump.json', { type: 'application/json' })
      const result = await startDbImport(file)

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/db-import')
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
      expect((init.body as FormData).get('file')).toBe(file)
      expect(init.headers['Authorization']).toBe('Bearer test-jwt-token')
      expect(result).toEqual(TASK_FIXTURE)
    })

    it('throws on non-OK response', async () => {
      mockFetch.mockReturnValueOnce(errorResponse(400, 'Invalid JSON'))

      const file = new File(['bad'], 'bad.json', { type: 'application/json' })
      await expect(startDbImport(file)).rejects.toThrow('Import failed: Invalid JSON')
    })
  })

  // ── startFilesImport ─────────────────────────────────────────────────

  describe('startFilesImport', () => {
    it('sends POST with FormData containing file', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const file = new File(['tar-data'], 'backup.tar.gz', { type: 'application/gzip' })
      const result = await startFilesImport(file)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/files-import')
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
      expect((init.body as FormData).get('file')).toBe(file)
      expect(result).toEqual(TASK_FIXTURE)
    })

    it('throws on non-OK response', async () => {
      mockFetch.mockReturnValueOnce(errorResponse(400, 'Invalid archive'))

      const file = new File(['bad'], 'bad.tar.gz', { type: 'application/gzip' })
      await expect(startFilesImport(file)).rejects.toThrow('Import failed: Invalid archive')
    })
  })

  // ── fetchAdminTasks ──────────────────────────────────────────────────

  describe('fetchAdminTasks', () => {
    it('sends GET to /api/admin/tasks', async () => {
      const tasks = [TASK_FIXTURE]
      mockFetch.mockReturnValueOnce(jsonResponse(tasks))

      const result = await fetchAdminTasks()

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks')
      expect(init.method).toBeUndefined() // GET is the default
      expect(result).toEqual(tasks)
    })
  })

  // ── fetchAdminTask ───────────────────────────────────────────────────

  describe('fetchAdminTask', () => {
    it('sends GET to /api/admin/tasks/:id', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const result = await fetchAdminTask(42)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/42')
      expect(result).toEqual(TASK_FIXTURE)
    })
  })

  // ── cancelAdminTask ──────────────────────────────────────────────────

  describe('cancelAdminTask', () => {
    it('sends POST to /api/admin/tasks/:id/cancel', async () => {
      const cancelled = { ...TASK_FIXTURE, status: 'cancelling' }
      mockFetch.mockReturnValueOnce(jsonResponse(cancelled))

      const result = await cancelAdminTask(42)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/42/cancel')
      expect(init.method).toBe('POST')
      expect(result.status).toBe('cancelling')
    })
  })

  // ── downloadAdminTaskResult ──────────────────────────────────────────

  describe('downloadAdminTaskResult', () => {
    it('fetches token then navigates to download URL', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ token: 'dl-token-abc' }))

      // Replace window.location with a writable mock
      const origLocation = window.location
      const mockLocation = { ...origLocation, href: '' }
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
        configurable: true,
      })

      await downloadAdminTaskResult(7)

      // First call: POST to get download token
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/7/download-token')
      expect(init.method).toBe('POST')

      // Then navigates browser to the token-authenticated download URL
      expect(mockLocation.href).toBe('/api/admin/tasks/7/download?token=dl-token-abc')

      // Restore
      Object.defineProperty(window, 'location', {
        value: origLocation,
        writable: true,
        configurable: true,
      })
    })
  })
})
