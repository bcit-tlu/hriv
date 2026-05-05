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
  initFilesImport,
  uploadTaskFile,
  startFilesImport,
  bulkImportImages,
  fetchAdminTasks,
  fetchAdminTask,
  cancelAdminTask,
  downloadAdminTaskResult,
  setToken,
  type ApiBulkImportJob,
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

const BULK_IMPORT_FIXTURE: ApiBulkImportJob = {
  id: 5,
  status: 'pending',
  category_id: 2,
  total_count: 3,
  completed_count: 0,
  failed_count: 0,
  errors: [],
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

  // ── initFilesImport ──────────────────────────────────────────────────

  describe('initFilesImport', () => {
    it('sends POST with filename query param', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const result = await initFilesImport('backup.tar.gz')

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/admin/tasks/files-import?filename=backup.tar.gz')
      expect(init.method).toBe('POST')
      expect(result).toEqual(TASK_FIXTURE)
    })

    it('throws on non-OK response', async () => {
      mockFetch.mockReturnValueOnce(errorResponse(400, 'Only .tar.gz / .tgz files are accepted'))

      await expect(initFilesImport('bad.zip')).rejects.toThrow('API 400')
    })
  })

  // ── uploadTaskFile ────────────────────────────────────────────────────

  describe('uploadTaskFile', () => {
    let xhrInstance: {
      open: ReturnType<typeof vi.fn>
      setRequestHeader: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      upload: { addEventListener: ReturnType<typeof vi.fn> }
      addEventListener: ReturnType<typeof vi.fn>
      status: number
      responseText: string
    }

    beforeEach(() => {
      xhrInstance = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        upload: { addEventListener: vi.fn() },
        addEventListener: vi.fn(),
        status: 200,
        responseText: JSON.stringify(TASK_FIXTURE),
      }
      // Use a regular function so it can be called with `new`
      vi.stubGlobal('XMLHttpRequest', function XMLHttpRequest() {
        return xhrInstance
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      // Re-stub the globals other tests need
      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, val: string) => { storage[key] = val },
        removeItem: (key: string) => { delete storage[key] },
      })
      vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
    })

    it('opens PUT to the upload endpoint', async () => {
      const file = new File(['tar-data'], 'backup.tar.gz', { type: 'application/gzip' })
      const promise = uploadTaskFile(42, file)

      // Simulate successful load
      const loadHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'load',
      )![1] as () => void
      loadHandler()

      const result = await promise
      expect(xhrInstance.open).toHaveBeenCalledWith('PUT', '/api/admin/tasks/42/upload')
      expect(xhrInstance.send).toHaveBeenCalled()
      expect(result).toEqual(TASK_FIXTURE)
    })

    it('rejects on XHR error', async () => {
      const file = new File(['tar-data'], 'backup.tar.gz', { type: 'application/gzip' })
      const promise = uploadTaskFile(42, file)

      const errorHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'error',
      )![1] as () => void
      errorHandler()

      await expect(promise).rejects.toThrow('Upload failed: network error')
    })

    it('calls onProgress callback', async () => {
      const onProgress = vi.fn()
      const file = new File(['tar-data'], 'backup.tar.gz', { type: 'application/gzip' })
      const promise = uploadTaskFile(42, file, onProgress)

      // Fire a progress event
      const progressHandler = xhrInstance.upload.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'progress',
      )![1] as (e: { lengthComputable: boolean; loaded: number; total: number }) => void
      progressHandler({ lengthComputable: true, loaded: 50, total: 100 })

      expect(onProgress).toHaveBeenCalledWith(0.5)

      // Complete
      const loadHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'load',
      )![1] as () => void
      loadHandler()
      await promise
    })
  })

  // ── bulkImportImages ──────────────────────────────────────────────────

  describe('bulkImportImages', () => {
    let xhrInstance: {
      open: ReturnType<typeof vi.fn>
      setRequestHeader: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      upload: { addEventListener: ReturnType<typeof vi.fn> }
      addEventListener: ReturnType<typeof vi.fn>
      status: number
      responseText: string
      statusText: string
    }

    beforeEach(() => {
      xhrInstance = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        upload: { addEventListener: vi.fn() },
        addEventListener: vi.fn(),
        status: 201,
        responseText: JSON.stringify(BULK_IMPORT_FIXTURE),
        statusText: 'Created',
      }
      vi.stubGlobal('XMLHttpRequest', function XMLHttpRequest() {
        return xhrInstance
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, val: string) => { storage[key] = val },
        removeItem: (key: string) => { delete storage[key] },
      })
      vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
    })

    it('uploads bulk imports with XHR progress reporting', async () => {
      const onProgress = vi.fn()
      const zip = new File(['zip-data'], 'images.zip', { type: 'application/zip' })
      const promise = bulkImportImages(
        [zip],
        2,
        'Public Domain',
        'Note',
        [1, 3],
        true,
        onProgress,
      )

      const progressHandler = xhrInstance.upload.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'progress',
      )![1] as (e: { lengthComputable: boolean; loaded: number; total: number }) => void
      progressHandler({ lengthComputable: true, loaded: 25, total: 100 })

      const loadHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'load',
      )![1] as () => void
      loadHandler()

      const result = await promise
      expect(onProgress).toHaveBeenCalledWith(0.25)
      expect(xhrInstance.open).toHaveBeenCalledWith('POST', '/api/admin/bulk-import/')
      expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-jwt-token')
      expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith('X-Session-ID', expect.any(String))
      expect(xhrInstance.send).toHaveBeenCalledOnce()
      const form = xhrInstance.send.mock.calls[0][0] as FormData
      expect(form.get('files')).toBe(zip)
      expect(form.get('category_id')).toBe('2')
      expect(form.getAll('program_ids')).toEqual(['1', '3'])
      expect(result).toEqual(BULK_IMPORT_FIXTURE)
    })

    it('rejects bulk import upload failures', async () => {
      xhrInstance.status = 500
      xhrInstance.responseText = 'Internal Server Error'
      const zip = new File(['zip-data'], 'images.zip', { type: 'application/zip' })
      const promise = bulkImportImages([zip], 2)

      const loadHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'load',
      )![1] as () => void
      loadHandler()

      await expect(promise).rejects.toThrow('Bulk import failed: Internal Server Error')
    })
  })

  // ── startFilesImport (convenience wrapper) ────────────────────────────

  describe('startFilesImport', () => {
    let xhrInstance: {
      open: ReturnType<typeof vi.fn>
      setRequestHeader: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      upload: { addEventListener: ReturnType<typeof vi.fn> }
      addEventListener: ReturnType<typeof vi.fn>
      status: number
      responseText: string
    }

    beforeEach(() => {
      xhrInstance = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        upload: { addEventListener: vi.fn() },
        addEventListener: vi.fn(),
        status: 200,
        responseText: JSON.stringify(TASK_FIXTURE),
      }
      vi.stubGlobal('XMLHttpRequest', function XMLHttpRequest() {
        return xhrInstance
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, val: string) => { storage[key] = val },
        removeItem: (key: string) => { delete storage[key] },
      })
      vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })
    })

    it('calls init then uploads via XHR', async () => {
      // Mock the init fetch call
      mockFetch.mockReturnValueOnce(jsonResponse(TASK_FIXTURE))

      const file = new File(['tar-data'], 'backup.tar.gz', { type: 'application/gzip' })
      const onInitiated = vi.fn()
      const promise = startFilesImport(file, onInitiated)

      // Wait for the init call to resolve
      await vi.waitFor(() => {
        expect(onInitiated).toHaveBeenCalledWith(TASK_FIXTURE)
      })

      // Simulate XHR load
      const loadHandler = xhrInstance.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'load',
      )![1] as () => void
      loadHandler()

      const result = await promise
      expect(result).toEqual(TASK_FIXTURE)
      expect(mockFetch).toHaveBeenCalledOnce()
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
