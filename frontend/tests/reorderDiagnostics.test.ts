import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/observability', () => ({
  emitEvent: vi.fn(),
}))

import { emitEvent } from '../src/observability'
import {
  emitReorderDiagnostic,
  newReorderOperationId,
  subscribeReorderDiagnostics,
  REORDER_OPERATION_STATES,
} from '../src/reorderDiagnostics'
import type { ReorderDiagnosticEvent } from '../src/reorderDiagnostics'

describe('newReorderOperationId', () => {
  it('generates unique, header-safe correlation IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newReorderOperationId()))
    expect(ids.size).toBe(100)
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    }
  })
})

describe('emitReorderDiagnostic', () => {
  beforeEach(() => {
    vi.mocked(emitEvent).mockReset()
  })

  it('notifies subscribers and forwards a reorder.operation telemetry event', () => {
    const seen: ReorderDiagnosticEvent[] = []
    const unsubscribe = subscribeReorderDiagnostics((e) => seen.push(e))

    const operationId = newReorderOperationId()
    emitReorderDiagnostic({
      operationId,
      state: 'submitted',
      scopeCategoryId: 42,
      itemType: 'category',
      itemId: 7,
      fromIndex: 3,
      toIndex: 17,
      categoryCount: 80,
      imageCount: 0,
      queueDepth: 0,
    })
    unsubscribe()

    expect(seen).toHaveLength(1)
    expect(seen[0].operationId).toBe(operationId)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reorder.operation',
        operation_id: operationId,
        state: 'submitted',
        outcome: 'unknown',
        item_type: 'category',
        category_id: 42,
        from_index: 3,
        to_index: 17,
        category_count: 80,
        image_count: 0,
        queue_depth: 0,
      }),
    )
  })

  it('maps lifecycle states to telemetry outcomes', () => {
    const outcomes: Record<string, string> = {}
    for (const state of REORDER_OPERATION_STATES) {
      vi.mocked(emitEvent).mockReset()
      emitReorderDiagnostic({ operationId: newReorderOperationId(), state })
      outcomes[state] = vi.mocked(emitEvent).mock.calls[0][0].outcome as string
    }
    expect(outcomes.committed).toBe('success')
    expect(outcomes.failed).toBe('failure')
    expect(outcomes.conflicted).toBe('failure')
    expect(outcomes.submitted).toBe('unknown')
    expect(outcomes.ignored).toBe('unknown')
    expect(outcomes.abandoned).toBe('unknown')
  })

  it('does not let a throwing subscriber break the flow', () => {
    const unsubscribeBad = subscribeReorderDiagnostics(() => {
      throw new Error('boom')
    })
    const seen: ReorderDiagnosticEvent[] = []
    const unsubscribeGood = subscribeReorderDiagnostics((e) => seen.push(e))

    expect(() =>
      emitReorderDiagnostic({ operationId: newReorderOperationId(), state: 'ignored' }),
    ).not.toThrow()
    expect(seen).toHaveLength(1)

    unsubscribeBad()
    unsubscribeGood()
  })

  it('only attaches image_id for image moves', () => {
    emitReorderDiagnostic({
      operationId: newReorderOperationId(),
      state: 'submitted',
      itemType: 'category',
      itemId: 9,
    })
    expect(vi.mocked(emitEvent).mock.calls[0][0].image_id).toBeUndefined()

    vi.mocked(emitEvent).mockReset()
    emitReorderDiagnostic({
      operationId: newReorderOperationId(),
      state: 'submitted',
      itemType: 'image',
      itemId: 9,
    })
    expect(vi.mocked(emitEvent).mock.calls[0][0].image_id).toBe(9)
  })
})
