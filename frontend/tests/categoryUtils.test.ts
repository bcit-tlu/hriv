import { describe, it, expect } from 'vitest'
import { narrowProgramIds } from '../src/categoryUtils'

describe('narrowProgramIds', () => {
  it('returns empty array for empty ancestors', () => {
    expect(narrowProgramIds([])).toEqual([])
  })

  it('returns empty array when no ancestor has programIds', () => {
    const ancestors = [
      { programIds: [] },
      { programIds: [] },
    ]
    expect(narrowProgramIds(ancestors)).toEqual([])
  })

  it('returns programIds from the first ancestor that has them', () => {
    const ancestors = [
      { programIds: [] },
      { programIds: [1, 2, 3] },
    ]
    expect(narrowProgramIds(ancestors)).toEqual([1, 2, 3])
  })

  it('intersects when multiple ancestors have programIds', () => {
    const ancestors = [
      { programIds: [1, 2, 3] },
      { programIds: [2, 3, 4] },
    ]
    expect(narrowProgramIds(ancestors)).toEqual([2, 3])
  })

  it('narrows progressively through three levels', () => {
    const ancestors = [
      { programIds: [1, 2, 3, 4] },
      { programIds: [2, 3, 4, 5] },
      { programIds: [3, 4, 5, 6] },
    ]
    // first: [1,2,3,4]; second intersects: [2,3,4]; third intersects: [3,4]
    expect(narrowProgramIds(ancestors)).toEqual([3, 4])
  })

  it('skips ancestors with empty programIds in the middle', () => {
    const ancestors = [
      { programIds: [1, 2, 3] },
      { programIds: [] },
      { programIds: [2, 3, 4] },
    ]
    // empty middle is skipped; intersection of [1,2,3] and [2,3,4]
    expect(narrowProgramIds(ancestors)).toEqual([2, 3])
  })

  it('returns empty array when intersection is empty', () => {
    const ancestors = [
      { programIds: [1, 2] },
      { programIds: [3, 4] },
    ]
    expect(narrowProgramIds(ancestors)).toEqual([])
  })

  it('handles single ancestor with programIds', () => {
    const ancestors = [{ programIds: [5, 6] }]
    expect(narrowProgramIds(ancestors)).toEqual([5, 6])
  })

  it('does not mutate the input ancestors', () => {
    const a1 = { programIds: [1, 2, 3] }
    const a2 = { programIds: [2, 3] }
    const ancestors = [a1, a2]
    narrowProgramIds(ancestors)
    expect(a1.programIds).toEqual([1, 2, 3])
    expect(a2.programIds).toEqual([2, 3])
    expect(ancestors).toHaveLength(2)
  })
})
