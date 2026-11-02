/**
 * useSelectionCounts (#1667): per-selection job lifecycle, poll backoff,
 * error mapping, re-run/cancel/cancelAll, unmount + pagehide teardown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  startCount: vi.fn(),
  getCount: vi.fn(),
  cancelCount: vi.fn(),
}))
vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>()
  return {
    ...actual,
    startCount: mocks.startCount,
    getCount: mocks.getCount,
    cancelCount: mocks.cancelCount,
  }
})

import { ApiError, type ApiCountJob } from '../src/api'
import { useSelectionCounts } from '../src/useSelectionCounts'

const SEL = { x: 10, y: 10, width: 100, height: 80 }

function job(partial: Partial<ApiCountJob>): ApiCountJob {
  return {
    job_id: 'j1',
    status: 'queued',
    queue_position: 0,
    mode: 'cells',
    selection: SEL,
    total: null,
    groups: [],
    objects: [],
    error: null,
    preview: null,
    ...partial,
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useSelectionCounts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.startCount.mockReset()
    mocks.getCount.mockReset()
    mocks.cancelCount.mockReset()
    mocks.cancelCount.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs start -> queued -> running -> done with the poll backoff', async () => {
    const d = deferred<ApiCountJob>()
    mocks.startCount.mockResolvedValue({
      job_id: 'j1',
      status: 'queued',
      queue_position: 0,
    })
    mocks.getCount.mockImplementation(() => d.promise)
    const { result } = renderHook(() => useSelectionCounts(5))

    await act(async () => {
      void result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    expect(mocks.startCount).toHaveBeenCalledWith(5, 'cells', SEL)
    expect(result.current.entries[0].phase).toBe('queued')
    expect(result.current.entries[0].jobId).toBe('j1')

    // First poll fires at 1000ms.
    const first = deferred<ApiCountJob>()
    mocks.getCount.mockImplementation(() => first.promise)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      first.resolve(job({ status: 'running' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.entries[0].phase).toBe('running')

    // Backoff: second poll at +1500ms.
    const second = deferred<ApiCountJob>()
    mocks.getCount.mockImplementation(() => second.promise)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    await act(async () => {
      second.resolve(
        job({
          status: 'done',
          total: 3,
          groups: [{ group: 0, count: 3 }],
          objects: [],
          preview: 'data:image/jpeg;base64,AAA',
        }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.entries[0].phase).toBe('done')
    expect(result.current.entries[0].result?.total).toBe(3)
    expect(result.current.entries[0].result?.preview).toContain('data:image/jpeg')
    // Terminal state: no further polls.
    const calls = mocks.getCount.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mocks.getCount.mock.calls.length).toBe(calls)
  })

  it('uses the 1000 -> 1500 -> 2000 -> 3000 (capped) backoff', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 1 })
    mocks.getCount.mockResolvedValue(job({ status: 'queued', queue_position: 1 }))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'nuclei')
    })
    // Poll 1 at 1000
    await act(async () => void (await vi.advanceTimersByTimeAsync(999)))
    expect(mocks.getCount).toHaveBeenCalledTimes(0)
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)))
    expect(mocks.getCount).toHaveBeenCalledTimes(1)
    // Poll 2 at +1500
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)))
    expect(mocks.getCount).toHaveBeenCalledTimes(2)
    // Poll 3 at +2000
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)))
    expect(mocks.getCount).toHaveBeenCalledTimes(3)
    // Poll 4 at +3000, still capped at 3000 for poll 5
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)))
    expect(mocks.getCount).toHaveBeenCalledTimes(4)
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)))
    expect(mocks.getCount).toHaveBeenCalledTimes(5)
  })

  it('maps a 404 poll to expired', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    mocks.getCount.mockRejectedValue(new ApiError(404, 'Not Found'))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.entries[0].phase).toBe('failed')
    expect(result.current.entries[0].error).toBe('expired')
  })

  it.each([
    [new ApiError(422, 'selection_too_large'), 'too_large'],
    [new ApiError(422, 'invalid_selection'), 'invalid_selection'],
    [new ApiError(422, '', [{ msg: 'x' }]), 'internal'],
    [new ApiError(429, 'too_many_active_counts'), 'rate_limited'],
    [new ApiError(503, 'counting_unavailable'), 'unavailable'],
    [new ApiError(409, 'tiles_not_ready'), 'tiles_not_ready'],
    [new Error('boom'), 'internal'],
  ])('maps start errors to %s', async (err, code) => {
    mocks.startCount.mockRejectedValue(err)
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    expect(result.current.entries[0].phase).toBe('failed')
    expect(result.current.entries[0].error).toBe(code)
  })

  it.each([
    ['too_large', 'too_large'],
    ['too_many_objects', 'too_many_objects'],
    ['timeout', 'timeout'],
    ['no_tiles', 'no_tiles'],
    ['weird', 'internal'],
  ])('maps job error "%s" -> %s', async (apiError, code) => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(job({ status: 'failed', error: apiError }))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.entries[0].phase).toBe('failed')
    expect(result.current.entries[0].error).toBe(code)
  })

  it('re-running a key cancels the previous job first', async () => {
    mocks.startCount
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued', queue_position: 0 })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(job({ status: 'queued', queue_position: 0 }))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    expect(result.current.entries[0].jobId).toBe('j1')
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'nuclei')
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].jobId).toBe('j2')
    expect(result.current.entries[0].mode).toBe('nuclei')
  })

  it('cancel removes the entry and cancels the job', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    act(() => result.current.cancel('k'))
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
    expect(result.current.entries).toHaveLength(0)
  })

  it('cancelAll deletes every job record — including done results', async () => {
    mocks.startCount
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued', queue_position: 0 })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(job({ status: 'done', total: 1, groups: [], objects: [] }))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('a', 'Selection 1', SEL, 'cells')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await result.current.start('b', 'Selection 2', SEL, 'cells')
    })
    act(() => result.current.cancelAll())
    // Ephemerality: done results are destroyed too — nothing lingers in Redis.
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
    expect(mocks.cancelCount).toHaveBeenCalledWith('j2', undefined)
    expect(result.current.entries).toHaveLength(0)
  })

  it('cancels active jobs on unmount', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    const { result, unmount } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    unmount()
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
  })

  it('cancels active jobs when imageId changes', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    const { result, rerender } = renderHook(({ id }) => useSelectionCounts(id), {
      initialProps: { id: 5 },
    })
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    rerender({ id: 6 })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
    expect(result.current.entries).toHaveLength(0)
  })

  it('sends keepalive cancels on pagehide', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', { keepalive: true })
  })

  it('cancels a server-side job created after cancel during starting', async () => {
    // Cancel while the POST is still in flight: the late 202 must not
    // register an entry and the server job must be deleted.
    const created = deferred<{ job_id: string; status: 'queued'; queue_position: number }>()
    mocks.startCount.mockImplementation(() => created.promise)
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      void result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    expect(result.current.entries[0].phase).toBe('starting')
    act(() => result.current.cancel('k'))
    await act(async () => {
      created.resolve({ job_id: 'j-late', status: 'queued', queue_position: 0 })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j-late')
    expect(result.current.entries).toHaveLength(0)
    // No poll was scheduled for the superseded job.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mocks.getCount).not.toHaveBeenCalled()
  })

  it('ignores a stale poll response after a re-run of the same key', async () => {
    mocks.startCount
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued', queue_position: 0 })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued', queue_position: 0 })
    const stalePoll = deferred<ApiCountJob>()
    mocks.getCount
      .mockImplementationOnce(() => stalePoll.promise)
      .mockResolvedValue(job({ job_id: 'j2', status: 'running' }))
    const { result } = renderHook(() => useSelectionCounts(5))
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    // Fire the first poll — it awaits a promise we resolve late.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mocks.getCount).toHaveBeenCalledWith('j1')
    // Re-run the same key while that poll is in flight.
    await act(async () => {
      await result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
    expect(result.current.entries[0].jobId).toBe('j2')
    // The stale j1 poll now resolves 'done' — it must NOT touch the j2 entry.
    await act(async () => {
      stalePoll.resolve(job({ job_id: 'j1', status: 'done', total: 99, groups: [], objects: [] }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.entries[0].jobId).toBe('j2')
    expect(result.current.entries[0].phase).not.toBe('done')
    // j2's own poll proceeds on its own schedule and updates the entry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.entries[0].phase).toBe('running')
  })

  it('cancels a server-side job created after an image switch mid-POST', async () => {
    const created = deferred<{ job_id: string; status: 'queued'; queue_position: number }>()
    mocks.startCount.mockImplementation(() => created.promise)
    const { result, rerender } = renderHook(({ id }) => useSelectionCounts(id), {
      initialProps: { id: 5 },
    })
    await act(async () => {
      void result.current.start('k', 'Selection 1', SEL, 'cells')
    })
    rerender({ id: 6 })
    await act(async () => {
      created.resolve({ job_id: 'j-orphan', status: 'queued', queue_position: 0 })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j-orphan')
    expect(result.current.entries).toHaveLength(0)
  })
})
