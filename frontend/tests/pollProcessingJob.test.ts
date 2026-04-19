/**
 * Unit tests for the single-job processing poller.
 *
 * Covers the subtle async interactions called out in
 * https://github.com/bcit-tlu/hriv/issues/26:
 *  - Slow network responses (polling interval vs response time)
 *  - Rapid sequential uploads (multiple independent handles)
 *  - Cancellation mid-process (AbortController signal)
 *  - Backend returning unexpected status codes during polling
 *  - Job completion detection and auto-refresh triggering
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    pollProcessingJob,
    type SourceImageStatus,
} from '../src/pollProcessingJob'

function makeStatus(
    partial: Partial<SourceImageStatus> & { status: string },
): SourceImageStatus {
    return {
        progress: 0,
        status_message: null,
        error_message: null,
        image_id: null,
        ...partial,
    }
}

/** Flush microtasks (promise callbacks, then-chains) pending in the queue. */
async function flushMicrotasks() {
    // Two awaits drain any promises resolved within the first drain.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

describe('pollProcessingJob', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('calls onCompleted with image_id when backend reports completed', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'completed', image_id: 42 }))
        const onCompleted = vi.fn()
        const onFailed = vi.fn()
        const onProgress = vi.fn()

        pollProcessingJob(1, {
            fetchStatus,
            onCompleted,
            onFailed,
            onProgress,
        })

        await flushMicrotasks()

        expect(fetchStatus).toHaveBeenCalledTimes(1)
        expect(fetchStatus).toHaveBeenCalledWith(1)
        expect(onCompleted).toHaveBeenCalledTimes(1)
        expect(onCompleted).toHaveBeenCalledWith(42)
        expect(onFailed).not.toHaveBeenCalled()
        expect(onProgress).not.toHaveBeenCalled()
    })

    it('passes null to onCompleted when image_id is missing', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'completed' }))
        const onCompleted = vi.fn()

        pollProcessingJob(1, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress: vi.fn(),
        })

        await flushMicrotasks()

        expect(onCompleted).toHaveBeenCalledWith(null)
    })

    it('calls onFailed with progress and error_message when backend reports failed', async () => {
        const fetchStatus = vi.fn().mockResolvedValue(
            makeStatus({
                status: 'failed',
                progress: 55,
                error_message: 'VIPS out of memory',
            }),
        )
        const onCompleted = vi.fn()
        const onFailed = vi.fn()

        pollProcessingJob(2, {
            fetchStatus,
            onCompleted,
            onFailed,
            onProgress: vi.fn(),
        })

        await flushMicrotasks()

        expect(onFailed).toHaveBeenCalledTimes(1)
        expect(onFailed).toHaveBeenCalledWith(55, 'VIPS out of memory')
        expect(onCompleted).not.toHaveBeenCalled()
    })

    it('passes null error message when backend omits it', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'failed', progress: 10 }))
        const onFailed = vi.fn()

        pollProcessingJob(3, {
            fetchStatus,
            onCompleted: vi.fn(),
            onFailed,
            onProgress: vi.fn(),
        })

        await flushMicrotasks()

        expect(onFailed).toHaveBeenCalledWith(10, null)
    })

    it('calls onProgress and reschedules another poll when status is non-terminal', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValueOnce(
                makeStatus({
                    status: 'processing',
                    progress: 30,
                    status_message: 'Tiling...',
                }),
            )
            .mockResolvedValueOnce(
                makeStatus({
                    status: 'processing',
                    progress: 70,
                    status_message: 'Almost done',
                }),
            )
            .mockResolvedValueOnce(
                makeStatus({ status: 'completed', image_id: 99 }),
            )
        const onCompleted = vi.fn()
        const onProgress = vi.fn()

        pollProcessingJob(4, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress,
            pollIntervalMs: 3000,
        })

        await flushMicrotasks()
        expect(onProgress).toHaveBeenNthCalledWith(1, 30, 'Tiling...')
        expect(onCompleted).not.toHaveBeenCalled()

        // Advance past one poll interval — second fetch should fire.
        await vi.advanceTimersByTimeAsync(3000)
        expect(fetchStatus).toHaveBeenCalledTimes(2)
        expect(onProgress).toHaveBeenNthCalledWith(2, 70, 'Almost done')

        // Advance past another interval — third fetch returns completed.
        await vi.advanceTimersByTimeAsync(3000)
        expect(fetchStatus).toHaveBeenCalledTimes(3)
        expect(onCompleted).toHaveBeenCalledWith(99)
    })

    it('treats unknown / pending backend status as progress and keeps polling', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValueOnce(
                makeStatus({ status: 'pending', progress: 0 }),
            )
            .mockResolvedValueOnce(
                makeStatus({ status: 'something-unexpected', progress: 5 }),
            )
            .mockResolvedValueOnce(
                makeStatus({ status: 'completed', image_id: 1 }),
            )
        const onProgress = vi.fn()
        const onCompleted = vi.fn()

        pollProcessingJob(5, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress,
            pollIntervalMs: 1000,
        })

        await flushMicrotasks()
        await vi.advanceTimersByTimeAsync(1000)
        await vi.advanceTimersByTimeAsync(1000)

        expect(onProgress).toHaveBeenCalledTimes(2)
        expect(onCompleted).toHaveBeenCalledTimes(1)
    })

    it('retries after fetch rejection using the configured interval', async () => {
        const fetchStatus = vi
            .fn()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(
                makeStatus({ status: 'completed', image_id: 7 }),
            )
        const onCompleted = vi.fn()

        pollProcessingJob(6, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress: vi.fn(),
            pollIntervalMs: 500,
        })

        await flushMicrotasks()
        expect(fetchStatus).toHaveBeenCalledTimes(1)
        expect(onCompleted).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(500)
        expect(fetchStatus).toHaveBeenCalledTimes(2)
        expect(onCompleted).toHaveBeenCalledWith(7)
    })

    it('cancel() stops further polls after an in-flight fetch resolves', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'processing', progress: 10 }))
        const onProgress = vi.fn()
        const onCompleted = vi.fn()

        const handle = pollProcessingJob(7, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress,
            pollIntervalMs: 1000,
        })

        await flushMicrotasks()
        expect(fetchStatus).toHaveBeenCalledTimes(1)
        expect(onProgress).toHaveBeenCalledTimes(1)

        handle.cancel()

        // Even after several intervals elapse, no more fetches fire.
        await vi.advanceTimersByTimeAsync(10_000)
        expect(fetchStatus).toHaveBeenCalledTimes(1)
        expect(onCompleted).not.toHaveBeenCalled()
    })

    it('cancel() before the first fetch resolves suppresses all callbacks', async () => {
        let resolveFetch: (v: SourceImageStatus) => void = () => {}
        const fetchStatus = vi.fn(
            () =>
                new Promise<SourceImageStatus>((r) => {
                    resolveFetch = r
                }),
        )
        const onCompleted = vi.fn()
        const onProgress = vi.fn()
        const onFailed = vi.fn()

        const handle = pollProcessingJob(8, {
            fetchStatus,
            onCompleted,
            onFailed,
            onProgress,
        })

        // Cancel before the pending fetch resolves.
        handle.cancel()
        resolveFetch(makeStatus({ status: 'completed', image_id: 1 }))

        await flushMicrotasks()

        expect(onCompleted).not.toHaveBeenCalled()
        expect(onProgress).not.toHaveBeenCalled()
        expect(onFailed).not.toHaveBeenCalled()
    })

    it('cancel() is idempotent (safe to call multiple times)', async () => {
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'processing', progress: 1 }))
        const handle = pollProcessingJob(9, {
            fetchStatus,
            onCompleted: vi.fn(),
            onFailed: vi.fn(),
            onProgress: vi.fn(),
        })
        await flushMicrotasks()

        expect(() => {
            handle.cancel()
            handle.cancel()
            handle.cancel()
        }).not.toThrow()
    })

    it('handles multiple concurrent jobs independently', async () => {
        const fetchA = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'completed', image_id: 100 }))
        const fetchB = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'failed', progress: 20 }))

        const completedA = vi.fn()
        const failedB = vi.fn()

        pollProcessingJob(10, {
            fetchStatus: fetchA,
            onCompleted: completedA,
            onFailed: vi.fn(),
            onProgress: vi.fn(),
        })
        pollProcessingJob(11, {
            fetchStatus: fetchB,
            onCompleted: vi.fn(),
            onFailed: failedB,
            onProgress: vi.fn(),
        })

        await flushMicrotasks()

        expect(completedA).toHaveBeenCalledWith(100)
        expect(failedB).toHaveBeenCalledWith(20, null)
    })

    it('awaits onCompleted before marking terminal (supports async refresh hooks)', async () => {
        let resolveRefresh: () => void = () => {}
        const refreshPromise = new Promise<void>((r) => {
            resolveRefresh = r
        })
        const onCompleted = vi.fn(() => refreshPromise)
        const fetchStatus = vi
            .fn()
            .mockResolvedValue(makeStatus({ status: 'completed', image_id: 1 }))

        pollProcessingJob(12, {
            fetchStatus,
            onCompleted,
            onFailed: vi.fn(),
            onProgress: vi.fn(),
        })

        await flushMicrotasks()
        expect(onCompleted).toHaveBeenCalledTimes(1)

        // Advance timers — no second fetch should be scheduled while we wait.
        await vi.advanceTimersByTimeAsync(10_000)
        expect(fetchStatus).toHaveBeenCalledTimes(1)

        resolveRefresh()
        await flushMicrotasks()
        // Still no additional fetch — terminal state was reached.
        expect(fetchStatus).toHaveBeenCalledTimes(1)
    })
})
