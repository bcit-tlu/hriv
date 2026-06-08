import { describe, it, expect } from 'vitest'
import {
  narrowGroupIds,
  narrowProgramIds,
  splitDirectAncestorProgramIds,
} from '../src/categoryUtils'

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

describe('splitDirectAncestorProgramIds', () => {
  it('returns empty direct and ancestor for empty path', () => {
    expect(splitDirectAncestorProgramIds([])).toEqual({ direct: [], ancestor: [] })
  })

  it('returns all as direct when leaf has all effective programs', () => {
    const path = [{ programIds: [1, 2] }]
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [1, 2], ancestor: [] })
  })

  it('splits programs into direct and ancestor', () => {
    const path = [
      { programIds: [1, 2, 3] },
      { programIds: [2, 3] },
    ]
    // effective = [2,3] (intersection); leaf has [2,3] → all direct
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [2, 3], ancestor: [] })
  })

  it('classifies ancestor-only IDs as ancestor', () => {
    const path = [
      { programIds: [1, 2, 3] },
      { programIds: [] },
    ]
    // effective = [1,2,3] (leaf has no own programs, skip); leaf.programIds = []
    // direct = []; ancestor = [1,2,3]
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [], ancestor: [1, 2, 3] })
  })

  it('splits when leaf has partial overlap with effective set', () => {
    const path = [
      { programIds: [1, 2, 3, 4] },
      { programIds: [2, 3] },
    ]
    // effective = intersection of [1,2,3,4] and [2,3] = [2,3]
    // leaf.programIds = [2,3] → direct = [2,3], ancestor = []
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [2, 3], ancestor: [] })
  })

  it('handles three-level path with mixed restrictions', () => {
    const path = [
      { programIds: [1, 2, 3, 4, 5] },
      { programIds: [2, 3, 4] },
      { programIds: [3, 6] },
    ]
    // level 0: effective = [1,2,3,4,5]
    // level 1: intersect → [2,3,4]
    // level 2: intersect → [3] (only 3 is in both [2,3,4] and [3,6])
    // leaf.programIds = [3,6]; directIds = {3,6}
    // direct = [3]; ancestor = []
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [3], ancestor: [] })
  })

  it('returns ancestor IDs when leaf has none of the effective set', () => {
    const path = [
      { programIds: [1, 2, 3] },
      { programIds: [1, 2] },
      { programIds: [10, 20] },
    ]
    // level 0: effective = [1,2,3]
    // level 1: intersect → [1,2]
    // level 2: intersect → [] (no overlap between [1,2] and [10,20])
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [], ancestor: [] })
  })

  it('handles leaf inheriting from grandparent when parent has no programs', () => {
    const path = [
      { programIds: [1, 2, 3] },
      { programIds: [] },
      { programIds: [2] },
    ]
    // level 0: effective = [1,2,3]
    // level 1: skip (empty)
    // level 2: intersect → [2]
    // leaf.programIds = [2]; direct = [2], ancestor = []
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [2], ancestor: [] })
  })

  it('produces ancestor IDs when leaf does not declare any of its own', () => {
    const path = [
      { programIds: [5, 6, 7] },
      { programIds: [5, 6] },
      { programIds: [] },
    ]
    // effective = [5,6]; leaf.programIds = []
    // direct = []; ancestor = [5,6]
    expect(splitDirectAncestorProgramIds(path)).toEqual({ direct: [], ancestor: [5, 6] })
  })
})

describe('narrowGroupIds', () => {
  it('returns empty array for empty ancestors', () => {
    expect(narrowGroupIds([])).toEqual([])
  })

  it('returns empty array when no ancestor has groupIds', () => {
    expect(narrowGroupIds([{ groupIds: [] }, { groupIds: [] }])).toEqual([])
  })

  it('returns groupIds from the first ancestor that has them', () => {
    expect(narrowGroupIds([{ groupIds: [] }, { groupIds: [1, 2, 3] }])).toEqual([1, 2, 3])
  })

  it('intersects when multiple ancestors have groupIds', () => {
    expect(
      narrowGroupIds([{ groupIds: [1, 2, 3] }, { groupIds: [2, 3, 4] }]),
    ).toEqual([2, 3])
  })

  it('narrows progressively through three levels', () => {
    expect(
      narrowGroupIds([
        { groupIds: [1, 2, 3, 4] },
        { groupIds: [2, 3, 4, 5] },
        { groupIds: [3, 4, 5, 6] },
      ]),
    ).toEqual([3, 4])
  })

  it('skips ancestors with empty groupIds in the middle', () => {
    expect(
      narrowGroupIds([
        { groupIds: [1, 2, 3] },
        { groupIds: [] },
        { groupIds: [2, 3, 4] },
      ]),
    ).toEqual([2, 3])
  })

  it('returns empty array when intersection is empty', () => {
    expect(narrowGroupIds([{ groupIds: [1, 2] }, { groupIds: [3, 4] }])).toEqual([])
  })

  it('does not mutate the input ancestors', () => {
    const a1 = { groupIds: [1, 2, 3] }
    const a2 = { groupIds: [2, 3] }
    narrowGroupIds([a1, a2])
    expect(a1.groupIds).toEqual([1, 2, 3])
    expect(a2.groupIds).toEqual([2, 3])
  })
})
