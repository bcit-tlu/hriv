/**
 * Per-selection ephemeral count-job state (epic #1661, #1667).
 *
 * Each drawn selection rectangle owns one job, keyed by a stable selection
 * key. Jobs are Redis-backed and die with the page: nothing is persisted to
 * localStorage or the URL, and every teardown path (clear-all, image
 * switch, unmount, pagehide) cancels outstanding jobs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, cancelCount, getCount, startCount } from './api'
import type { ApiCountJob, ApiCountObject, ApiCountSelection, CountMode } from './api'
import type { CountObject } from './countAdjust'

export type CountPhase = 'starting' | 'queued' | 'running' | 'done' | 'failed'

export type CountErrorCode =
  | 'too_large'
  | 'rate_limited'
  | 'unavailable'
  | 'tiles_not_ready'
  | 'invalid_selection'
  | 'timeout'
  | 'too_many_objects'
  | 'no_tiles'
  | 'internal'
  | 'expired'

export interface CountResult {
  total: number
  groups: { group: number; count: number }[]
  objects: ApiCountObject[]
  preview: string | null
}

export interface SelectionCountEntry {
  key: string
  /** Display label, e.g. "Selection 2". */
  label: string
  mode: CountMode
  selection: ApiCountSelection
  phase: CountPhase
  queuePosition: number | null
  jobId: string | null
  result?: CountResult
  error?: CountErrorCode
  /**
   * Manual adjustment (#1746): combined indices the user marked removed.
   * An index counts into ``result.objects`` first, then ``added`` —
   * index ``objects.length + j`` refers to ``added[j]``. Client-side only;
   * adjustments die with the ephemeral result.
   */
  removed?: number[]
  /** Manual adjustment (#1746): outlines the user drew on the report. */
  added?: CountObject[]
}

const POLL_BACKOFF_MS = [1000, 1500, 2000, 3000]

function errorCodeFromApi(err: unknown): CountErrorCode {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'expired'
    if (err.status === 409) return 'tiles_not_ready'
    if (err.status === 429) return 'rate_limited'
    if (err.status === 503) return 'unavailable'
    if (err.status === 422) {
      // String details are our stable codes; pydantic list details -> internal.
      if (err.detail === 'selection_too_large') return 'too_large'
      if (err.detail === 'invalid_selection') return 'invalid_selection'
      return 'internal'
    }
  }
  return 'internal'
}

function errorCodeFromJob(error: string | null | undefined): CountErrorCode {
  switch (error) {
    case 'too_large':
      return 'too_large'
    case 'too_many_objects':
      return 'too_many_objects'
    case 'timeout':
      return 'timeout'
    case 'no_tiles':
      return 'no_tiles'
    default:
      return 'internal'
  }
}

export function useSelectionCounts(imageId: number) {
  const [entries, setEntries] = useState<SelectionCountEntry[]>([])
  const entriesRef = useRef<SelectionCountEntry[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pollStepRef = useRef<Map<string, number>>(new Map())
  // Per-key generation token: bumped whenever a key's in-flight work is
  // superseded (cancel, re-run, clear-all, image switch). Any await whose
  // captured generation no longer matches drops its result — a stale poll
  // can neither write into a superseded entry nor reschedule itself, and a
  // stale startCount response is cancelled server-side.
  const genRef = useRef<Map<string, number>>(new Map())
  const cancelledRef = useRef(false)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const bumpGen = useCallback((key: string) => {
    genRef.current.set(key, (genRef.current.get(key) ?? 0) + 1)
  }, [])

  const isCurrent = useCallback(
    (key: string, gen: number) => !cancelledRef.current && genRef.current.get(key) === gen,
    [],
  )

  const updateEntry = useCallback((key: string, patch: Partial<SelectionCountEntry>) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  }, [])

  const clearTimer = useCallback((key: string) => {
    const t = timersRef.current.get(key)
    if (t !== undefined) {
      clearTimeout(t)
      timersRef.current.delete(key)
    }
  }, [])

  const cancel = useCallback(
    (key: string, opts?: { keepalive?: boolean }) => {
      bumpGen(key)
      clearTimer(key)
      const entry = entriesRef.current.find((e) => e.key === key)
      setEntries((prev) => prev.filter((e) => e.key !== key))
      if (entry?.jobId) void cancelCount(entry.jobId, opts)
    },
    [bumpGen, clearTimer],
  )

  const cancelAll = useCallback(
    (opts?: { keepalive?: boolean }) => {
      for (const key of [...timersRef.current.keys()]) clearTimer(key)
      // Invalidate every in-flight await for this image — including POSTs
      // still in 'starting' (their jobId isn't known yet).
      for (const e of entriesRef.current) bumpGen(e.key)
      // Ephemerality: every entry with a jobId gets its record deleted —
      // including done/failed results, which would otherwise linger in
      // Redis for the TTL.
      setEntries([])
      for (const e of entriesRef.current) {
        if (e.jobId) void cancelCount(e.jobId, opts)
      }
    },
    [bumpGen, clearTimer],
  )

  // --- Manual adjustment (#1746) -----------------------------------------
  // Toggle-remove restores on a second click; added outlines behave the
  // same — a soft-removed addition just stops counting until re-clicked.

  const toggleObject = useCallback((key: string, index: number) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.key !== key) return e
        const removed = e.removed ?? []
        return {
          ...e,
          removed: removed.includes(index)
            ? removed.filter((i) => i !== index)
            : [...removed, index],
        }
      }),
    )
  }, [])

  const addObject = useCallback((key: string, obj: CountObject) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.key === key ? { ...e, added: [...(e.added ?? []), { ...obj, manual: true }] } : e,
      ),
    )
  }, [])

  const resetAdjustments = useCallback((key: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, removed: undefined, added: undefined } : e)),
    )
  }, [])

  const applyJob = useCallback(
    (key: string, job: ApiCountJob) => {
      if (job.status === 'done') {
        clearTimer(key)
        updateEntry(key, {
          phase: 'done',
          queuePosition: null,
          result: {
            total: job.total ?? 0,
            groups: job.groups ?? [],
            objects: job.objects ?? [],
            preview: job.preview,
          },
        })
        return true
      }
      if (job.status === 'failed') {
        clearTimer(key)
        updateEntry(key, {
          phase: 'failed',
          queuePosition: null,
          error: errorCodeFromJob(job.error),
        })
        return true
      }
      updateEntry(key, {
        phase: job.status === 'running' ? 'running' : 'queued',
        queuePosition: job.queue_position,
      })
      return false
    },
    [clearTimer, updateEntry],
  )

  // Named function expression so the poll can reschedule itself.
  const schedulePoll = useCallback(
    function poll(key: string, jobId: string) {
      const gen = genRef.current.get(key) ?? 0
      const step = pollStepRef.current.get(key) ?? 0
      const delay = POLL_BACKOFF_MS[Math.min(step, POLL_BACKOFF_MS.length - 1)]
      pollStepRef.current.set(key, step + 1)
      clearTimer(key)
      timersRef.current.set(
        key,
        setTimeout(() => {
          void (async () => {
            try {
              const job = await getCount(jobId)
              if (!isCurrent(key, gen)) return
              if (!applyJob(key, job)) poll(key, jobId)
            } catch (err) {
              if (!isCurrent(key, gen)) return
              clearTimer(key)
              updateEntry(key, {
                phase: 'failed',
                queuePosition: null,
                error: errorCodeFromApi(err),
              })
            }
          })()
        }, delay),
      )
    },
    [applyJob, clearTimer, isCurrent, updateEntry],
  )

  const start = useCallback(
    async (key: string, label: string, selection: ApiCountSelection, mode: CountMode) => {
      // Re-running a key cancels its previous job first.
      cancel(key)
      bumpGen(key)
      const gen = genRef.current.get(key) as number
      pollStepRef.current.set(key, 0)
      setEntries((prev) => [
        ...prev,
        {
          key,
          label,
          mode,
          selection,
          phase: 'starting',
          queuePosition: null,
          jobId: null,
        },
      ])
      try {
        const created = await startCount(imageId, mode, selection)
        if (!isCurrent(key, gen)) {
          // Superseded mid-flight: the user cancelled/re-ran during
          // 'starting', or the image changed. The server job exists but
          // nothing client-side tracks it — delete it so it can't linger
          // or consume the per-user cap.
          void cancelCount(created.job_id)
          return
        }
        updateEntry(key, { phase: 'queued', jobId: created.job_id })
        schedulePoll(key, created.job_id)
      } catch (err) {
        if (!isCurrent(key, gen)) return
        updateEntry(key, {
          phase: 'failed',
          queuePosition: null,
          error: errorCodeFromApi(err),
        })
      }
    },
    [bumpGen, cancel, imageId, isCurrent, schedulePoll, updateEntry],
  )

  // Teardown: imageId change and unmount cancel everything; pagehide sends
  // keepalive DELETEs for still-active jobs.
  useEffect(() => {
    cancelledRef.current = false
    const onPageHide = () => cancelAll({ keepalive: true })
    window.addEventListener('pagehide', onPageHide)
    return () => {
      cancelledRef.current = true
      window.removeEventListener('pagehide', onPageHide)
      cancelAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId])

  return { entries, start, cancel, cancelAll, toggleObject, addObject, resetAdjustments }
}
