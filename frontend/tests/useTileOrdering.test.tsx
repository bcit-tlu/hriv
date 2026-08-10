import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useMostSevereScope, useTileOrdering } from '../src/useTileOrdering'
import { tileOrderingCoordinator } from '../src/tileOrdering'
import {
  getTileOrder,
  putTileOrder,
  type TileOrderItemRef,
  type TileOrderResponse,
} from '../src/api'

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

function response(revision: number, ids: number[]): TileOrderResponse {
  return {
    scope: { parent_category_id: null },
    revision,
    items: ids.map((id, i) => ({ type: 'image' as const, id, sort_order: i })),
  }
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// The coordinator is a module singleton; isolate each test with a fresh scope.
let scopeCounter = 9000

describe('useTileOrdering', () => {
  let scope: number

  beforeEach(() => {
    vi.clearAllMocks()
    scope = scopeCounter++
  })

  afterEach(() => {
    cleanup()
  })

  it('reflects coordinator status and displayOrder updates', async () => {
    mockedGet.mockResolvedValue(response(1, [1, 2]))
    mockedPut.mockResolvedValue(response(2, [2, 1]))

    const { result } = renderHook(() => useTileOrdering(scope))
    expect(result.current.status).toBe('idle')
    expect(result.current.displayOrder).toBeNull()

    act(() => {
      result.current.reportOrder([
        { type: 'image', id: 2 },
        { type: 'image', id: 1 },
      ])
    })
    expect(result.current.displayOrder).toEqual([
      { type: 'image', id: 2 },
      { type: 'image', id: 1 },
    ])

    await flushMicrotasks()
    expect(result.current.status).toBe('saved')
    expect(mockedPut).toHaveBeenCalledTimes(1)
  })

  it('binds callbacks to the hook scope', () => {
    const spy = vi.spyOn(tileOrderingCoordinator, 'reportOrder')
    const { result } = renderHook(() => useTileOrdering(scope))
    act(() => {
      result.current.reportOrder([{ type: 'image', id: 5 }], 3)
    })
    expect(spy).toHaveBeenCalledWith(scope, [{ type: 'image', id: 5 }], 3)
    spy.mockRestore()
  })

  it('claimGeneration claims monotonically for the scope', () => {
    const { result } = renderHook(() => useTileOrdering(scope))
    const first = result.current.claimGeneration()
    const second = result.current.claimGeneration()
    expect(second).toBe(first + 1)
    expect(tileOrderingCoordinator.isCurrentGeneration(scope, second)).toBe(true)
    expect(tileOrderingCoordinator.isCurrentGeneration(scope, first)).toBe(false)
  })

  it('retry re-submits the newest order after a failure', async () => {
    mockedGet.mockResolvedValue(response(1, [1, 2]))
    mockedPut.mockRejectedValueOnce(new Error('network down'))

    const { result } = renderHook(() => useTileOrdering(scope))
    act(() => {
      result.current.reportOrder([
        { type: 'image', id: 2 },
        { type: 'image', id: 1 },
      ])
    })
    await flushMicrotasks()
    expect(result.current.status).toBe('error')

    mockedPut.mockResolvedValueOnce(response(2, [2, 1]))
    act(() => {
      result.current.retry()
    })
    await flushMicrotasks()
    expect(result.current.status).toBe('saved')
  })

  it('registers and removes the beforeunload guard', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useTileOrdering(scope))
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    const handler = addSpy.mock.calls.find(([type]) => type === 'beforeunload')?.[1]

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', handler)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('beforeunload prompts only while unsaved changes exist', () => {
    const hasUnsaved = vi.spyOn(tileOrderingCoordinator, 'hasUnsavedChanges')
    renderHook(() => useTileOrdering(scope))

    hasUnsaved.mockReturnValue(false)
    let event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)

    hasUnsaved.mockReturnValue(true)
    event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    hasUnsaved.mockRestore()
  })
})

// `useMostSevereScope` (issue #982): a cross-parent move in Manage
// Categories touches two scopes and the single save-state indicator must
// surface whichever scope most urgently needs attention.
describe('useMostSevereScope', () => {
  it('returns undefined when no scopes are tracked', () => {
    const { result } = renderHook(() => useMostSevereScope(null))
    expect(result.current).toBeUndefined()
    const { result: empty } = renderHook(() => useMostSevereScope([]))
    expect(empty.current).toBeUndefined()
  })

  it('surfaces the scope with a failed save over a saved one', async () => {
    // Unique scope ids: the coordinator is a module-level singleton.
    mockedGet.mockResolvedValue(response(1, [1, 2]))
    mockedPut.mockResolvedValueOnce(response(2, [1, 2]))
    mockedPut.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useMostSevereScope([901, 902]))

    await act(async () => {
      tileOrderingCoordinator.reportOrder(901, refs(1, 2))
      await flushMicrotasks()
      tileOrderingCoordinator.reportOrder(902, refs(2, 1))
      await flushMicrotasks()
    })

    expect(tileOrderingCoordinator.getScope(901).status).toBe('saved')
    expect(tileOrderingCoordinator.getScope(902).status).toBe('error')
    expect(result.current).toBe(902)
  })
})
