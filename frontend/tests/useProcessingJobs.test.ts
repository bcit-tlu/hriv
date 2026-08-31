import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  MAX_REHYDRATED_FAILURES,
  useProcessingJobs,
  type UseProcessingJobsDeps,
  type ProcessingJob,
} from '../src/useProcessingJobs'
import { ApiError, type ApiBulkImportJob, type ApiSourceImage } from '../src/api'

function makeFailedSourceImage(overrides: Partial<ApiSourceImage> = {}): ApiSourceImage {
  const now = new Date().toISOString()
  return {
    id: 7,
    original_filename: 'broken.tiff',
    status: 'failed',
    progress: 40,
    error_message: 'Processing failed: unsupported format',
    status_message: null,
    name: null,
    category_id: null,
    copyright: null,
    note: null,
    active: true,
    image_id: null,
    file_size: 1234,
    source_checksum: null,
    tile_settings_hash: null,
    tiles_generated_at: null,
    tile_cache_status: 'missing',
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function makeDeps(overrides: Partial<UseProcessingJobsDeps> = {}): UseProcessingJobsDeps {
  return {
    fetchSourceImage: vi.fn().mockResolvedValue({
      status: 'processing',
      progress: 0,
      status_message: null,
      error_message: null,
      image_id: null,
    }),
    fetchBulkImportJob: vi.fn().mockResolvedValue({
      id: 1,
      status: 'importing',
      total_count: 10,
      completed_count: 0,
      failed_count: 0,
      errors: null,
    } as ApiBulkImportJob),
    fetchImage: vi.fn().mockResolvedValue({
      id: 1,
      name: 'test.tiff',
      thumb: '/thumb.jpg',
      tile_sources: '/tiles/1.dzi',
      category_id: null,
      copyright: null,
      note: null,
      active: true,
      sort_order: 0,
      version: 1,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      metadata_extra: null,
      width: 1000,
      height: 1000,
      file_size: 5000,
    }),
    listFailedSourceImages: vi.fn().mockResolvedValue([]),
    loadCategories: vi.fn().mockResolvedValue(undefined),
    loadUncategorizedImages: vi.fn().mockResolvedValue(undefined),
    selectedImageRef: { current: null },
    setSelectedImage: vi.fn(),
    setImagesVersion: vi.fn(),
    ...overrides,
  }
}

describe('useProcessingJobs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('addProcessingJob', () => {
    it('adds a new processing job', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })

      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        id: 42,
        filename: 'test.tiff',
        status: 'processing',
        kind: 'image',
        serverProgress: 0,
        fileSize: 5000,
      })
    })

    it('does not add duplicate jobs with the same id', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })
      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })

      expect(result.current.processingJobs).toHaveLength(1)
    })

    it('respects MAX_PROCESSING_JOBS limit', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        for (let i = 0; i < 6; i++) {
          result.current.addProcessingJob(i + 1, `file${i}.tiff`, 1000)
        }
      })

      expect(result.current.processingJobs).toHaveLength(5)
    })
  })

  describe('handleUploadStarted', () => {
    it('creates an uploading job', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(100, 'upload.tiff', 3000)
      })

      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        id: -100,
        filename: 'upload.tiff',
        status: 'uploading',
        kind: 'image',
        uploadId: 100,
        uploadProgress: 0,
      })
    })
  })

  describe('handleUploadProgress', () => {
    it('tracks upload progress via ref (getUploadProgress)', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(100, 'upload.tiff', 3000)
      })
      act(() => {
        result.current.handleUploadProgress(100, 0.5)
      })

      expect(result.current.getUploadProgress(100)).toBe(0.5)
    })

    it('returns 0 for unknown upload IDs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      expect(result.current.getUploadProgress(999)).toBe(0)
    })
  })

  describe('handleUploadFailed', () => {
    it('marks the uploading job as failed', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(100, 'upload.tiff', 3000)
      })
      act(() => {
        result.current.handleUploadFailed(100, 'Network error')
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'Network error',
      })
    })
  })

  describe('handleProcessingStarted', () => {
    it('transitions an uploading job to processing', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(100, 'upload.tiff', 3000)
      })
      act(() => {
        result.current.handleProcessingStarted(42, 'upload.tiff', 3000, 100)
      })

      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        id: 42,
        status: 'processing',
        kind: 'image',
      })
      // uploadId should be cleared
      expect(result.current.processingJobs[0].uploadId).toBeUndefined()
    })

    it('creates a new processing job if no matching upload exists', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleProcessingStarted(42, 'upload.tiff', 3000, 999)
      })

      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        id: 42,
        status: 'processing',
      })
    })

    it('marks a confirmed-complete job completed when refresh hits auth failure', async () => {
      const deps = makeDeps({
        fetchSourceImage: vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          status_message: 'Done',
          error_message: null,
          image_id: 42,
        }),
        loadCategories: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
        loadUncategorizedImages: vi.fn().mockResolvedValue(undefined),
      })
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'upload.tiff', 3000)
      })
      await act(async () => {
        await flushMicrotasks()
      })

      expect(deps.fetchSourceImage).toHaveBeenCalledTimes(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        id: 42,
        status: 'completed',
        imageId: 42,
        serverProgress: 100,
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(deps.fetchSourceImage).toHaveBeenCalledTimes(1)
    })

    it('retries a completed image refresh when any follow-up refresh fails with a non-auth error', async () => {
      const deps = makeDeps({
        fetchSourceImage: vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          status_message: 'Done',
          error_message: null,
          image_id: 42,
        }),
        loadCategories: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
        loadUncategorizedImages: vi.fn().mockRejectedValue(new Error('boom')),
      })
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'upload.tiff', 3000)
      })
      await act(async () => {
        await flushMicrotasks()
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        id: 42,
        status: 'processing',
      })
      expect(deps.fetchSourceImage).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })

      expect(deps.fetchSourceImage).toHaveBeenCalledTimes(2)
    })

    it('uses the latest completion refresh handlers for an in-flight image job after rerender', async () => {
      const firstLoadCategories = vi.fn().mockResolvedValue(undefined)
      const firstLoadUncategorizedImages = vi.fn().mockResolvedValue(undefined)
      const updatedLoadCategories = vi.fn().mockResolvedValue(undefined)
      const updatedLoadUncategorizedImages = vi.fn().mockResolvedValue(undefined)

      const initialDeps = makeDeps({
        fetchSourceImage: vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          status_message: 'Done',
          error_message: null,
          image_id: 42,
        }),
        loadCategories: firstLoadCategories,
        loadUncategorizedImages: firstLoadUncategorizedImages,
      })

      const { result, rerender } = renderHook(
        (deps: UseProcessingJobsDeps) => useProcessingJobs(deps),
        {
          initialProps: initialDeps,
        },
      )

      act(() => {
        result.current.addProcessingJob(42, 'upload.tiff', 3000)
      })

      const updatedDeps: UseProcessingJobsDeps = {
        ...initialDeps,
        loadCategories: updatedLoadCategories,
        loadUncategorizedImages: updatedLoadUncategorizedImages,
      }
      rerender(updatedDeps)

      await act(async () => {
        await flushMicrotasks()
      })

      expect(updatedLoadCategories).toHaveBeenCalledTimes(1)
      expect(updatedLoadUncategorizedImages).toHaveBeenCalledTimes(1)
      expect(firstLoadCategories).not.toHaveBeenCalled()
      expect(firstLoadUncategorizedImages).not.toHaveBeenCalled()
    })
  })

  describe('handleBulkImportStarted', () => {
    it('creates a bulk import job from an upload', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(100, 'archive.zip', 50000)
      })

      const bulkJob: ApiBulkImportJob = {
        id: 5,
        status: 'importing',
        total_count: 10,
        completed_count: 0,
        failed_count: 0,
        errors: null,
      }
      act(() => {
        result.current.handleBulkImportStarted(bulkJob, 'archive.zip', 50000, 100)
      })

      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        kind: 'bulk-import',
        status: 'importing',
        bulkImportJobId: 5,
      })
    })

    it('stops polling and surfaces an auth error when bulk import status returns 401', async () => {
      const deps = makeDeps({
        fetchBulkImportJob: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
      })
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleBulkImportStarted(
          {
            id: 5,
            status: 'importing',
            total_count: 10,
            completed_count: 3,
            failed_count: 0,
            errors: null,
          },
          'archive.zip',
          50_000,
        )
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        kind: 'bulk-import',
        status: 'failed',
        errorMessage:
          'Bulk import status tracking stopped because your session ended or became invalid. The import may still complete on the server. Log back in and refresh to confirm.',
      })
      expect(deps.fetchBulkImportJob).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(deps.fetchBulkImportJob).toHaveBeenCalledTimes(1)
    })

    it('marks a completed bulk import done when completion refresh hits auth failure', async () => {
      const deps = makeDeps({
        fetchBulkImportJob: vi.fn().mockResolvedValue({
          id: 5,
          status: 'completed',
          total_count: 10,
          completed_count: 10,
          failed_count: 0,
          errors: null,
        }),
        loadCategories: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
      })
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleBulkImportStarted(
          {
            id: 5,
            status: 'importing',
            total_count: 10,
            completed_count: 9,
            failed_count: 0,
            errors: null,
          },
          'archive.zip',
          50_000,
        )
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
        await flushMicrotasks()
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        kind: 'bulk-import',
        status: 'completed',
        bulkImportJobId: 5,
        serverProgress: 100,
      })
      expect(deps.fetchBulkImportJob).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(deps.fetchBulkImportJob).toHaveBeenCalledTimes(1)
    })

    it('uses the latest completion refresh handlers for an in-flight bulk import after rerender', async () => {
      const firstLoadCategories = vi.fn().mockResolvedValue(undefined)
      const firstLoadUncategorizedImages = vi.fn().mockResolvedValue(undefined)
      const updatedLoadCategories = vi.fn().mockResolvedValue(undefined)
      const updatedLoadUncategorizedImages = vi.fn().mockResolvedValue(undefined)

      const initialDeps = makeDeps({
        fetchBulkImportJob: vi.fn().mockResolvedValue({
          id: 5,
          status: 'completed',
          total_count: 10,
          completed_count: 10,
          failed_count: 0,
          errors: null,
        }),
        loadCategories: firstLoadCategories,
        loadUncategorizedImages: firstLoadUncategorizedImages,
      })

      const { result, rerender } = renderHook(
        (deps: UseProcessingJobsDeps) => useProcessingJobs(deps),
        {
          initialProps: initialDeps,
        },
      )

      act(() => {
        result.current.handleBulkImportStarted(
          {
            id: 5,
            status: 'importing',
            total_count: 10,
            completed_count: 9,
            failed_count: 0,
            errors: null,
          },
          'archive.zip',
          50_000,
        )
      })

      const updatedDeps: UseProcessingJobsDeps = {
        ...initialDeps,
        loadCategories: updatedLoadCategories,
        loadUncategorizedImages: updatedLoadUncategorizedImages,
      }
      rerender(updatedDeps)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
        await flushMicrotasks()
      })

      expect(updatedLoadCategories).toHaveBeenCalledTimes(1)
      expect(updatedLoadUncategorizedImages).toHaveBeenCalledTimes(1)
      expect(firstLoadCategories).not.toHaveBeenCalled()
      expect(firstLoadUncategorizedImages).not.toHaveBeenCalled()
    })
  })

  describe('dismissJob', () => {
    it('removes a job by id', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })
      expect(result.current.processingJobs).toHaveLength(1)

      act(() => {
        result.current.dismissJob(42)
      })
      expect(result.current.processingJobs).toHaveLength(0)
    })
  })

  describe('rehydrateFailedJobs', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('restores persisted failures as terminal failed jobs without polling', async () => {
      const src = makeFailedSourceImage()
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue([src]) })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })

      expect(result.current.processingJobs).toEqual([
        expect.objectContaining({
          id: src.id,
          filename: src.original_filename,
          status: 'failed',
          kind: 'image',
          origin: 'rehydrated',
          errorMessage: src.error_message,
        }),
      ])
      // Terminal failures must not start a processing poller.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(deps.fetchSourceImage).not.toHaveBeenCalled()
    })

    it('runs only once per session but retries after a failed fetch', async () => {
      const listFailedSourceImages = vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([makeFailedSourceImage()])
      const deps = makeDeps({ listFailedSourceImages })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(result.current.processingJobs).toHaveLength(0)

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(listFailedSourceImages).toHaveBeenCalledTimes(2)
      expect(result.current.processingJobs).toHaveLength(1)
    })

    it('ignores failures older than the recency cutoff', async () => {
      const stale = makeFailedSourceImage({
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue([stale]) })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(result.current.processingJobs).toHaveLength(0)
    })

    it('does not duplicate a failure already tracked live', async () => {
      const src = makeFailedSourceImage({ id: 42 })
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue([src]) })
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })
      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(result.current.processingJobs).toHaveLength(1)
    })

    it('caps the number of restored failures', async () => {
      const many = Array.from({ length: MAX_REHYDRATED_FAILURES + 5 }, (_, i) =>
        makeFailedSourceImage({ id: i + 1 }),
      )
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue(many) })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(result.current.processingJobs).toHaveLength(MAX_REHYDRATED_FAILURES)
    })

    it('does not restore failures the user dismissed, across reloads', async () => {
      const src = makeFailedSourceImage()
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue([src]) })
      const first = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await first.result.current.rehydrateFailedJobs()
      })
      act(() => {
        first.result.current.dismissJob(src.id)
      })
      expect(first.result.current.processingJobs).toHaveLength(0)

      // A fresh hook instance stands in for a page reload.
      const second = renderHook(() => useProcessingJobs(deps))
      await act(async () => {
        await second.result.current.rehydrateFailedJobs()
      })
      expect(second.result.current.processingJobs).toHaveLength(0)
    })

    it('rehydrates again after resetAll so a new user gets their own failures', async () => {
      const listFailedSourceImages = vi.fn().mockResolvedValue([makeFailedSourceImage()])
      const deps = makeDeps({ listFailedSourceImages })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      act(() => {
        result.current.resetAll()
      })
      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      expect(listFailedSourceImages).toHaveBeenCalledTimes(2)
      expect(result.current.processingJobs).toHaveLength(1)
    })

    it('leaves restored failures out of the active job cap', async () => {
      const many = Array.from({ length: 6 }, (_, i) => makeFailedSourceImage({ id: i + 1 }))
      const deps = makeDeps({ listFailedSourceImages: vi.fn().mockResolvedValue(many) })
      const { result } = renderHook(() => useProcessingJobs(deps))

      await act(async () => {
        await result.current.rehydrateFailedJobs()
      })
      act(() => {
        result.current.handleUploadStarted(101, 'new.tiff', 100)
      })
      expect(result.current.processingJobs.some((job) => job.status === 'uploading')).toBe(true)
    })
  })

  describe('getDisplayProgress', () => {
    it('returns 100 for completed jobs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const job: ProcessingJob = {
        id: 1,
        filename: 'test.tiff',
        status: 'completed',
        kind: 'image',
        serverProgress: 100,
        fileSize: 5000,
        startedAt: Date.now(),
      }
      expect(result.current.getDisplayProgress(job)).toBe(100)
    })

    it('returns serverProgress for importing jobs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const job: ProcessingJob = {
        id: 1,
        filename: 'test.zip',
        status: 'importing',
        kind: 'bulk-import',
        serverProgress: 45,
        fileSize: 50000,
        startedAt: Date.now(),
      }
      expect(result.current.getDisplayProgress(job)).toBe(45)
    })

    it('returns time-based interpolated progress for processing jobs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const job: ProcessingJob = {
        id: 1,
        filename: 'test.tiff',
        status: 'processing',
        kind: 'image',
        serverProgress: 0,
        fileSize: 1024 * 1024, // 1 MB → estimated 2500 ms
        startedAt: Date.now() - 1250, // Half of estimated duration
      }
      const progress = result.current.getDisplayProgress(job)
      // Should be > 0 due to time-based interpolation
      expect(progress).toBeGreaterThan(0)
      expect(progress).toBeLessThan(100)
    })
  })

  describe('getStatusMessage', () => {
    it('returns empty string when no message is set', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const job: ProcessingJob = {
        id: 1,
        filename: 'test.tiff',
        status: 'processing',
        kind: 'image',
        serverProgress: 0,
        fileSize: 5000,
        startedAt: Date.now(),
      }
      expect(result.current.getStatusMessage(job)).toBe('')
    })

    it('returns the job statusMessage when set', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const job: ProcessingJob = {
        id: 1,
        filename: 'test.tiff',
        status: 'processing',
        kind: 'image',
        serverProgress: 50,
        fileSize: 5000,
        startedAt: Date.now(),
        statusMessage: 'Generating tiles...',
      }
      expect(result.current.getStatusMessage(job)).toBe('Generating tiles...')
    })
  })

  describe('getVisibleJobs', () => {
    it('shows all non-uploading/non-failed jobs regardless of modal state', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })

      const visible = result.current.getVisibleJobs({
        uploadOpen: true,
        manageUploadOpen: false,
        imageEditOpen: false,
        browseEditImage: null,
      })
      expect(visible).toHaveLength(1)
    })

    it('hides upload-modal jobs when uploadOpen is true', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      // Create an uploading job with Date.now()-style uploadId (>= 1 billion)
      act(() => {
        result.current.handleUploadStarted(1_500_000_000, 'upload.tiff', 3000)
      })

      const visible = result.current.getVisibleJobs({
        uploadOpen: true,
        manageUploadOpen: false,
        imageEditOpen: false,
        browseEditImage: null,
      })
      expect(visible).toHaveLength(0)
    })

    it('shows upload-modal jobs when uploadOpen is false', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.handleUploadStarted(1_500_000_000, 'upload.tiff', 3000)
      })

      const visible = result.current.getVisibleJobs({
        uploadOpen: false,
        manageUploadOpen: false,
        imageEditOpen: false,
        browseEditImage: null,
      })
      expect(visible).toHaveLength(1)
    })

    it('hides replace jobs when imageEditOpen is true', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      // Replace jobs have uploadId < 1 billion
      const file = new File(['test'], 'replace.tiff', { type: 'image/tiff' })
      act(() => {
        result.current.startReplaceUpload(file, 'viewer')
      })

      const visible = result.current.getVisibleJobs({
        uploadOpen: false,
        manageUploadOpen: false,
        imageEditOpen: true,
        browseEditImage: null,
      })
      expect(visible).toHaveLength(0)
    })
  })

  describe('startReplaceUpload', () => {
    it('creates an uploading job and returns uploadId + abort controller', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })

      expect(replaceResult!.uploadId).toBeGreaterThanOrEqual(2_000_000)
      expect(replaceResult!.abort).toBeInstanceOf(AbortController)
      expect(result.current.processingJobs).toHaveLength(1)
      expect(result.current.processingJobs[0]).toMatchObject({
        status: 'uploading',
        filename: 'replace.tiff',
        uploadId: replaceResult!.uploadId,
      })
    })

    it('assigns incrementing upload IDs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file1 = new File(['a'], 'a.tiff', { type: 'image/tiff' })
      const file2 = new File(['b'], 'b.tiff', { type: 'image/tiff' })
      let r1: { uploadId: number; abort: AbortController }
      let r2: { uploadId: number; abort: AbortController }
      act(() => {
        r1 = result.current.startReplaceUpload(file1, 'viewer')
      })
      act(() => {
        r2 = result.current.startReplaceUpload(file2, 'browse')
      })

      expect(r2!.uploadId).toBe(r1!.uploadId + 1)
    })
  })

  describe('transitionReplaceToProcessing', () => {
    it('transitions a replace upload to processing status', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })
      act(() => {
        result.current.transitionReplaceToProcessing(replaceResult!.uploadId, 99)
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        id: 99,
        status: 'processing',
      })
      expect(result.current.processingJobs[0].uploadId).toBeUndefined()
    })
  })

  describe('failReplaceUpload', () => {
    it('marks a replace upload as failed with error message', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })
      act(() => {
        result.current.failReplaceUpload(replaceResult!.uploadId, 'Server error')
      })

      expect(result.current.processingJobs[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'Server error',
      })
    })
  })

  describe('removeReplaceUpload', () => {
    it('removes the replace upload job entirely', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })
      act(() => {
        result.current.removeReplaceUpload(replaceResult!.uploadId)
      })

      expect(result.current.processingJobs).toHaveLength(0)
    })
  })

  describe('cancelReplace', () => {
    it('aborts the active replace upload', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })

      expect(replaceResult!.abort.signal.aborted).toBe(false)
      act(() => {
        result.current.cancelReplace()
      })
      expect(replaceResult!.abort.signal.aborted).toBe(true)
    })
  })

  describe('getReplaceUploadProgress', () => {
    it('returns undefined when no active replace in the given context', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      expect(result.current.getReplaceUploadProgress('viewer')).toBeUndefined()
    })

    it('returns progress for the active replace context', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      const file = new File(['data'], 'replace.tiff', { type: 'image/tiff' })
      let replaceResult: { uploadId: number; abort: AbortController }
      act(() => {
        replaceResult = result.current.startReplaceUpload(file, 'viewer')
      })
      act(() => {
        result.current.trackReplaceProgress(replaceResult!.uploadId, 0.75)
      })

      expect(result.current.getReplaceUploadProgress('viewer')).toBe(0.75)
      expect(result.current.getReplaceUploadProgress('browse')).toBeUndefined()
    })
  })

  describe('resetAll', () => {
    it('clears all jobs and refs', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(1, 'a.tiff', 1000)
        result.current.addProcessingJob(2, 'b.tiff', 2000)
      })
      expect(result.current.processingJobs).toHaveLength(2)

      act(() => {
        result.current.resetAll()
      })
      expect(result.current.processingJobs).toHaveLength(0)
    })
  })

  describe('interpolation timer', () => {
    it('starts a 500ms timer when active jobs exist', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })

      // The timer triggers re-renders but doesn't change processingJobs.
      // We verify it doesn't throw and the hook remains stable.
      act(() => {
        vi.advanceTimersByTime(1500) // 3 ticks
      })

      expect(result.current.processingJobs).toHaveLength(1)
    })
  })

  describe('unmount cleanup', () => {
    it('cleans up polling refs on unmount', () => {
      const deps = makeDeps()
      const { result, unmount } = renderHook(() => useProcessingJobs(deps))

      act(() => {
        result.current.addProcessingJob(42, 'test.tiff', 5000)
      })

      // Should not throw on unmount
      unmount()
    })
  })
})
