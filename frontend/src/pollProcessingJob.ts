/**
 * Polling helper for a single image-processing job.
 *
 * Extracted from `App.tsx` so the subtle async flow (setTimeout chaining,
 * AbortController cancellation, completed/failed/progress dispatch) can be
 * unit tested without rendering the full application.
 *
 * The caller is responsible for orchestrating multiple concurrent jobs;
 * this helper handles the state machine for exactly one job.
 */

export interface SourceImageStatus {
    /** Backend-reported status — any string is tolerated; only the three
     * recognized values below trigger callbacks. */
    status: string
    /** Integer 0–100. */
    progress: number
    status_message?: string | null
    error_message?: string | null
    image_id?: number | null
}

export interface PollProcessingJobCallbacks {
    /** Fetch the current status of the job.  Rejections are treated as
     * transient errors and the poll is retried after `pollIntervalMs`. */
    fetchStatus: (jobId: number) => Promise<SourceImageStatus>
    /** Called exactly once when the backend reports `status === "completed"`. */
    onCompleted: (imageId: number | null) => void | Promise<void>
    /** Called exactly once when the backend reports `status === "failed"`. */
    onFailed: (progress: number, errorMessage: string | null) => void
    /** Called on every poll that reports a non-terminal status. */
    onProgress: (progress: number, statusMessage: string | null) => void
    /** Interval between polls, in milliseconds.  Defaults to 3000. */
    pollIntervalMs?: number
}

export interface PollHandle {
    /** Abort any in-flight fetch and cancel the scheduled next poll.
     * Safe to call multiple times. */
    cancel(): void
}

const DEFAULT_POLL_INTERVAL_MS = 3000

/**
 * Begin polling a single processing job.
 *
 * Invariants:
 * - At most one in-flight fetch is outstanding at any time.
 * - Terminal callbacks (`onCompleted` / `onFailed`) fire at most once.
 * - After `cancel()` no further callbacks fire.
 * - Transient fetch rejections schedule a retry at the same interval.
 */
export function pollProcessingJob(
    jobId: number,
    cb: PollProcessingJobCallbacks,
): PollHandle {
    const controller = new AbortController()
    const interval = cb.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    let timer: ReturnType<typeof setTimeout> | null = null
    let terminated = false

    const scheduleNext = () => {
        if (controller.signal.aborted || terminated) return
        timer = setTimeout(poll, interval)
    }

    const poll = async () => {
        if (controller.signal.aborted || terminated) return
        try {
            const src = await cb.fetchStatus(jobId)
            if (controller.signal.aborted || terminated) return

            if (src.status === 'completed') {
                terminated = true
                await cb.onCompleted(src.image_id ?? null)
                return
            }
            if (src.status === 'failed') {
                terminated = true
                cb.onFailed(src.progress, src.error_message ?? null)
                return
            }

            cb.onProgress(src.progress, src.status_message ?? null)
            scheduleNext()
        } catch {
            // Transient error — retry on the same schedule.
            scheduleNext()
        }
    }

    // Kick off the first poll.
    void poll()

    return {
        cancel() {
            controller.abort()
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
        },
    }
}
