import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProcessingJobs, type UseProcessingJobsDeps, type ProcessingJob } from '../src/useProcessingJobs'
import type { ApiBulkImportJob } from '../src/api'

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
