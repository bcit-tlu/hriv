import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  loadDismissedFailedUploads,
  saveDismissedFailedUploads,
} from '../src/dismissedFailedUploads'

const KEY = 'hrivpref:dismissed-failed-uploads:user:anonymous'

describe('dismissedFailedUploads', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips ids for the current user scope', () => {
    saveDismissedFailedUploads(new Set([1, 2]), 'anonymous')
    expect(localStorage.getItem(KEY)).toBe('[1,2]')
    expect([...loadDismissedFailedUploads('anonymous')]).toEqual([1, 2])
  })

  it('keeps user scopes separate', () => {
    saveDismissedFailedUploads(new Set([1]), 'user-a')
    expect(loadDismissedFailedUploads('user-b').size).toBe(0)
  })

  it('returns an empty set for missing, malformed, and non-array values', () => {
    expect(loadDismissedFailedUploads('anonymous').size).toBe(0)

    localStorage.setItem(KEY, 'not json')
    expect(loadDismissedFailedUploads('anonymous').size).toBe(0)

    localStorage.setItem(KEY, '{"a":1}')
    expect(loadDismissedFailedUploads('anonymous').size).toBe(0)
  })

  it('drops non-numeric entries', () => {
    localStorage.setItem(KEY, '[1,"2",null,3]')
    expect([...loadDismissedFailedUploads('anonymous')]).toEqual([1, 3])
  })

  it('caps stored ids so the key cannot grow without bound', () => {
    const ids = new Set(Array.from({ length: 250 }, (_, i) => i + 1))
    saveDismissedFailedUploads(ids, 'anonymous')
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]
    expect(stored).toHaveLength(200)
    expect(stored[stored.length - 1]).toBe(250)
  })

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(loadDismissedFailedUploads('anonymous').size).toBe(0)
    expect(() => saveDismissedFailedUploads(new Set([1]), 'anonymous')).not.toThrow()
  })
})
