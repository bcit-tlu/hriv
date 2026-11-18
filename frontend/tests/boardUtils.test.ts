import { describe, expect, it } from 'vitest'
import { markerViewParams, moveBoardMember, ownsBoard, parseBoardLocation } from '../src/boardUtils'
import { BOARDS_FIXTURES, BOARD_ITEMS, BOARD_USER } from '../src/components/boardsFixtures'

describe('Board navigation and membership order', () => {
  it('reorders the flat membership list without losing or duplicating members', () => {
    const result = moveBoardMember(BOARDS_FIXTURES[0], 7, 2)
    expect(result.map((row) => row.marker_id)).toEqual([8, 9, 7, 10, 11, 12])
    expect(new Set(result.map((row) => row.marker_id)).size).toBe(6)
  })

  it.each([
    '',
    '?page=boards',
    '?page=boards&board=no&section=12',
    '?page=boards&board=-1',
    '?page=boards&board=1.5',
    '?board=1',
  ])('rejects absent and invalid Board ids: %s', (search) =>
    expect(parseBoardLocation(search)).toEqual({ boardId: null }),
  )
  it('ignores obsolete grouping parameters on Board deep links', () =>
    expect(parseBoardLocation('?page=boards&board=1&section=11')).toEqual({
      boardId: 1,
    }))
  it('recognizes both user and program ownership, not edit permission alone', () => {
    expect(ownsBoard(BOARDS_FIXTURES[0], BOARD_USER)).toBe(true)
    expect(ownsBoard({ ...BOARDS_FIXTURES[0], owners: [], owner_program_id: 1 }, BOARD_USER)).toBe(
      true,
    )
    expect(ownsBoard(BOARDS_FIXTURES[2], BOARD_USER)).toBe(false)
    expect(ownsBoard(BOARDS_FIXTURES[0], null)).toBe(false)
  })
  it('serializes the existing saved-view URL parameters including zero and rotation', () =>
    expect(markerViewParams({ ...BOARD_ITEMS[0], x: 0, rotation: 90 })).toEqual({
      image: '42',
      x: '0',
      y: '0.29',
      zoom: '2.5',
      rotation: '90',
    }))
})
