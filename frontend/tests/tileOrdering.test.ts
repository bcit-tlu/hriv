import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TileOrderingCoordinator } from '../src/tileOrdering'
import { ApiError, type TileOrderItemRef, type TileOrderResponse } from '../src/api'
import { getTileOrder, putTileOrder } from '../src/api'
import { subscribeReorderDiagnostics, type ReorderDiagnosticEvent } from '../src/reorderDiagnostics'

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api')
  return {
    ...actual,
    getTileOrder: vi.fn(),
    putTileOrder: vi.fn(),
  }
})

const mockedGet = vi.mocked(getTileOrder)
const mockedPut = vi.mocked(putTileOrder)

function refs(...ids: number[]): TileOrderItemRef[] {
  return ids.map((id) => ({ type: 'image' as const, id }))
}

function response(revision: number, order: TileOrderItemRef[]): TileOrderResponse {
  return {
    scope: { parent_category_id: null },
    revision,
    items: order.map((ref, i) => ({ ...ref, sort_order: i })),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function conflictError(current: TileOrderResponse): ApiError {
  return new ApiError(409, 'Stale tile-order revision', {
    message: 'Stale tile-order revision',
    current,
  })
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TileOrderingCoordinator', () => {
  let coordinator: TileOrderingCoordinator
  let events: ReorderDiagnosticEvent[]
  let unsubscribe: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    coordinator = new TileOrderingCoordinator()
    events = []
    unsubscribe?.()
    unsubscribe = subscribeReorderDiagnostics((event) => events.push(event))
    mockedGet.mockResolvedValue(response(1, refs(1, 2, 3)))
  })

  it('persists a reported order and applies the authoritative response', async () => {
    mockedPut.mockResolvedValue(response(2, refs(2, 1, 3)))

    coordinator.reportOrder(null, refs(2, 1, 3))
    // The flush starts synchronously (revision seeding), so the scope is
    // already saving by the time the caller observes it.
    expect(coordinator.getScope(null).status).toBe('saving')
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('saved')
    expect(state.revision).toBe(2)
    expect(state.displayOrder).toEqual(refs(2, 1, 3))
    expect(mockedPut).toHaveBeenCalledTimes(1)
    expect(mockedPut).toHaveBeenCalledWith(null, 1, refs(2, 1, 3), expect.any(String))
  })

  it('queues a second drag during an active save instead of discarding it', async () => {
    const first = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)
    mockedPut.mockResolvedValueOnce(response(3, refs(3, 2, 1)))

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    expect(coordinator.getScope(null).status).toBe('saving')

    coordinator.reportOrder(null, refs(3, 2, 1))
    expect(coordinator.getScope(null).status).toBe('dirty-while-saving')
    expect(coordinator.getScope(null).displayOrder).toEqual(refs(3, 2, 1))
    expect(events.some((e) => e.state === 'queued')).toBe(true)

    first.resolve(response(2, refs(2, 1, 3)))
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('saved')
    expect(state.revision).toBe(3)
    expect(state.displayOrder).toEqual(refs(3, 2, 1))
    expect(mockedPut).toHaveBeenCalledTimes(2)
    expect(mockedPut).toHaveBeenLastCalledWith(null, 2, refs(3, 2, 1), expect.any(String))

    // The queued snapshot's operation ID carries through to its submission
    // and terminal event, so the lifecycle correlates end to end.
    const queuedId = events.find((e) => e.state === 'queued')?.operationId
    const submittedIds = events.filter((e) => e.state === 'submitted').map((e) => e.operationId)
    const committedIds = events.filter((e) => e.state === 'committed').map((e) => e.operationId)
    expect(queuedId).toBeDefined()
    expect(submittedIds).toContain(queuedId)
    expect(committedIds).toContain(queuedId)
  })

  it('coalesces many rapid changes to the newest snapshot', async () => {
    const first = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)
    mockedPut.mockResolvedValueOnce(response(3, refs(1, 3, 2)))

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    coordinator.reportOrder(null, refs(3, 2, 1))
    coordinator.reportOrder(null, refs(3, 1, 2))
    coordinator.reportOrder(null, refs(1, 3, 2))
    expect(events.filter((e) => e.state === 'coalesced').length).toBe(2)

    first.resolve(response(2, refs(2, 1, 3)))
    await flushMicrotasks()

    // Only the newest snapshot was submitted after the in-flight save.
    expect(mockedPut).toHaveBeenCalledTimes(2)
    expect(mockedPut).toHaveBeenLastCalledWith(null, 2, refs(1, 3, 2), expect.any(String))
    expect(coordinator.getScope(null).displayOrder).toEqual(refs(1, 3, 2))
    expect(coordinator.getScope(null).status).toBe('saved')
  })

  it('does not show saved while newer local changes accumulated during the save', async () => {
    const first = deferred<TileOrderResponse>()
    const second = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)
    mockedPut.mockReturnValueOnce(second.promise)

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    coordinator.reportOrder(null, refs(3, 2, 1))

    first.resolve(response(2, refs(2, 1, 3)))
    await flushMicrotasks()

    // The first save succeeded but a newer snapshot is being persisted:
    // the user must not see a false "saved" state, and the newer local
    // order must not be rolled back to the first response.
    const state = coordinator.getScope(null)
    expect(state.status).toBe('saving')
    expect(state.displayOrder).toEqual(refs(3, 2, 1))

    second.resolve(response(3, refs(3, 2, 1)))
    await flushMicrotasks()
    expect(coordinator.getScope(null).status).toBe('saved')
  })

  it('keeps pending state across grid unmount/remount (module-owned state)', async () => {
    const first = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    coordinator.reportOrder(null, refs(3, 2, 1))

    // Grid unmounts and remounts (navigation): state is owned here, not by
    // the component, so the queued snapshot and status are preserved.
    coordinator.claimGeneration(null)
    const state = coordinator.getScope(null)
    expect(state.status).toBe('dirty-while-saving')
    expect(state.pending).toEqual(refs(3, 2, 1))
    expect(state.displayOrder).toEqual(refs(3, 2, 1))
  })

  it('ignores callbacks from a stale grid generation', () => {
    const first = coordinator.claimGeneration(null)
    const second = coordinator.claimGeneration(null)

    coordinator.reportOrder(null, refs(2, 1, 3), first)
    expect(coordinator.getScope(null).status).toBe('idle')
    expect(coordinator.getScope(null).displayOrder).toBeNull()

    coordinator.reportOrder(null, refs(3, 2, 1), second)
    expect(coordinator.getScope(null).displayOrder).toEqual(refs(3, 2, 1))
  })

  it('retains retryable local intent after a failure', async () => {
    mockedPut.mockRejectedValueOnce(new ApiError(500, 'boom'))
    mockedPut.mockResolvedValueOnce(response(2, refs(2, 1, 3)))

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()

    let state = coordinator.getScope(null)
    expect(state.status).toBe('error')
    expect(state.pending).toEqual(refs(2, 1, 3))
    expect(state.displayOrder).toEqual(refs(2, 1, 3))
    expect(events.some((e) => e.state === 'failed')).toBe(true)

    coordinator.retry(null)
    await flushMicrotasks()
    state = coordinator.getScope(null)
    expect(state.status).toBe('saved')
    expect(state.revision).toBe(2)
  })

  it('a failure does not roll back newer local changes', async () => {
    const first = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    coordinator.reportOrder(null, refs(3, 2, 1))

    first.reject(new ApiError(500, 'boom'))
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('error')
    // The newest local intent wins over the failed older snapshot.
    expect(state.pending).toEqual(refs(3, 2, 1))
    expect(state.displayOrder).toEqual(refs(3, 2, 1))
  })

  it('surfaces a 409 as conflict and adopts the server order on accept', async () => {
    const current = response(7, refs(3, 1, 2))
    mockedPut.mockRejectedValueOnce(conflictError(current))

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()

    let state = coordinator.getScope(null)
    expect(state.status).toBe('conflict')
    expect(state.revision).toBe(7)
    expect(state.conflictOrder).toEqual(refs(3, 1, 2))
    expect(events.some((e) => e.state === 'conflicted')).toBe(true)

    coordinator.acceptServerOrder(null)
    state = coordinator.getScope(null)
    expect(state.status).toBe('saved')
    expect(state.displayOrder).toEqual(refs(3, 1, 2))
    expect(state.conflictOrder).toBeNull()
  })

  it('treats a 400 membership change like a conflict and refreshes via GET', async () => {
    const current = response(4, refs(3, 1, 2))
    mockedPut.mockRejectedValueOnce(new ApiError(400, 'Images not in scope: [99]'))
    mockedGet.mockResolvedValue(current)

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('conflict')
    expect(state.revision).toBe(4)
    expect(state.conflictOrder).toEqual(refs(3, 1, 2))
    // The stale snapshot is retained for explicit resolution, not re-PUT.
    expect(state.pending).toEqual(refs(2, 1, 3))
    expect(mockedPut).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.state === 'conflicted')).toBe(true)
  })

  it('shows saving during seeding and emits a failed diagnostic when the seed GET fails', async () => {
    let rejectGet: (err: unknown) => void = () => {}
    mockedGet.mockImplementation(
      () => new Promise<never>((_resolve, reject) => (rejectGet = reject)),
    )

    coordinator.reportOrder(null, refs(2, 1, 3))
    await flushMicrotasks()
    expect(coordinator.getScope(null).status).toBe('saving')

    rejectGet(new ApiError(500, 'boom'))
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('error')
    expect(state.pending).toEqual(refs(2, 1, 3))
    expect(mockedPut).not.toHaveBeenCalled()
    const failed = events.filter((e) => e.state === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].errorCode).toBe('api_http_5xx')
  })

  it('seeds the revision with GET before the first save of a scope', async () => {
    mockedGet.mockResolvedValue(response(5, refs(1, 2, 3)))
    mockedPut.mockResolvedValue(response(6, refs(2, 1, 3)))

    coordinator.reportOrder(7, refs(2, 1, 3))
    await flushMicrotasks()

    expect(mockedGet).toHaveBeenCalledWith(7)
    expect(mockedPut).toHaveBeenCalledWith(7, 5, refs(2, 1, 3), expect.any(String))
    expect(coordinator.getScope(7).revision).toBe(6)
  })

  it('twenty rapid reorders resolve to the final local order', async () => {
    mockedPut.mockImplementation((_scope, revision, items) =>
      Promise.resolve(response(revision + 1, items as TileOrderItemRef[])),
    )

    let order = refs(1, 2, 3, 4, 5)
    for (let i = 0; i < 20; i++) {
      order = [...order.slice(1), order[0]]
      coordinator.reportOrder(null, order)
    }
    await flushMicrotasks()
    await flushMicrotasks()

    const state = coordinator.getScope(null)
    expect(state.status).toBe('saved')
    expect(state.displayOrder).toEqual(order)
    // Far fewer requests than drops: intermediate snapshots coalesced.
    expect(mockedPut.mock.calls.length).toBeLessThan(20)
    const lastCall = mockedPut.mock.calls[mockedPut.mock.calls.length - 1]
    expect(lastCall[2]).toEqual(order)
  })

  it('reports unsaved changes for the unload guard', async () => {
    expect(coordinator.hasUnsavedChanges()).toBe(false)
    const first = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(first.promise)

    coordinator.reportOrder(null, refs(2, 1, 3))
    expect(coordinator.hasUnsavedChanges()).toBe(true)
    await flushMicrotasks()
    expect(coordinator.hasUnsavedChanges()).toBe(true)

    first.resolve(response(2, refs(2, 1, 3)))
    await flushMicrotasks()
    expect(coordinator.hasUnsavedChanges()).toBe(false)
  })

  it('releaseCleanScopes drops saved scopes but keeps scopes with local intent', async () => {
    mockedGet.mockResolvedValue(response(1, refs(1, 2)))
    mockedPut.mockResolvedValueOnce(response(2, refs(2, 1)))
    coordinator.reportOrder(null, refs(2, 1))
    await flushMicrotasks()
    expect(coordinator.getScope(null).status).toBe('saved')

    const pending = deferred<TileOrderResponse>()
    mockedPut.mockReturnValueOnce(pending.promise)
    coordinator.reportOrder(7, refs(4, 3))
    await flushMicrotasks()
    expect(coordinator.getScope(7).status).toBe('saving')

    coordinator.releaseCleanScopes()
    // Clean scope: cached order/revision dropped so fresh data wins.
    expect(coordinator.getScope(null).displayOrder).toBeNull()
    expect(coordinator.getScope(null).revision).toBeNull()
    // In-flight scope: untouched.
    expect(coordinator.getScope(7).status).toBe('saving')
    expect(coordinator.getScope(7).displayOrder).toEqual(refs(4, 3))

    pending.resolve(response(2, refs(4, 3)))
    await flushMicrotasks()
  })

  it('reset clears all scope state on logout/user switch', async () => {
    mockedGet.mockResolvedValue(response(1, refs(1, 2)))
    mockedPut.mockRejectedValueOnce(new Error('boom'))
    coordinator.reportOrder(null, refs(2, 1))
    await flushMicrotasks()
    expect(coordinator.hasUnsavedChanges()).toBe(true)

    coordinator.reset()
    expect(coordinator.hasUnsavedChanges()).toBe(false)
    expect(coordinator.getScope(null).status).toBe('idle')
    expect(coordinator.getScope(null).displayOrder).toBeNull()
  })
})
