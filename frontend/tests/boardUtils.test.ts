import { describe, expect, it } from 'vitest'
import {
  boardMemberOrder,
  groupBoardMembers,
  inuksukViewParams,
  moveBoardMember,
  ownsBoard,
  parseBoardLocation,
} from '../src/boardUtils'
import { BOARDS_FIXTURES, BOARD_ITEMS, BOARD_USER } from '../src/components/boardsFixtures'

describe('Board navigation and membership order', () => {
  it('groups by displayed Section order, retaining member order and placing Unsectioned last', () => {
    const board = BOARDS_FIXTURES[0]
    const groups = groupBoardMembers({
      ...board,
      sections: [...board.sections].reverse(),
      inuksuks: [...board.inuksuks].reverse(),
    })
    expect(groups.map((section) => [section.id, section.inuksuks.map((item) => item.id)])).toEqual([
      [12, [11, 10]],
      [11, [9, 8, 7]],
      [null, [12]],
    ])
  })
  it('retains empty Sections and the empty Unsectioned group', () => {
    const board = BOARDS_FIXTURES[0]
    expect(
      groupBoardMembers({ ...board, inuksuks: [] }).map((section) => [
        section.id,
        section.inuksuks,
      ]),
    ).toEqual([
      [11, []],
      [12, []],
      [null, []],
    ])
    expect(groupBoardMembers({ ...board, sections: [], inuksuks: [] })).toEqual([
      { id: null, name: 'Unsectioned', inuksuks: [] },
    ])
  })
  it.each([
    '',
    '?page=boards',
    '?page=boards&board=no&section=12',
    '?page=boards&board=-1',
    '?page=boards&board=1.5',
    '?board=1',
  ])('rejects absent and invalid Board ids: %s', (search) =>
    expect(parseBoardLocation(search)).toEqual({ boardId: null, sectionId: null }),
  )
  it('parses Board and Section deep links', () =>
    expect(parseBoardLocation('?page=boards&board=1&section=11')).toEqual({
      boardId: 1,
      sectionId: 11,
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
    expect(inuksukViewParams({ ...BOARD_ITEMS[0], x: 0, rotation: 90 })).toEqual({
      image: '42',
      x: '0',
      y: '0.29',
      zoom: '2.5',
      rotation: '90',
    }))
  it('moves between Sections, preserving every visible member exactly once', () => {
    const board = BOARDS_FIXTURES[0]
    const moved = boardMemberOrder(board, [7], null)
    expect(moved.at(-1)).toEqual({ inuksuk_id: 7, section_id: null })
    expect(new Set(moved.map((row) => row.inuksuk_id)).size).toBe(board.inuksuks.length)
    expect(moved.find((row) => row.inuksuk_id === 8)?.section_id).toBe(11)
  })
  it('reorders inside a Section and inserts into another Section at the projected position', () => {
    const board = BOARDS_FIXTURES[0]
    expect(
      moveBoardMember(board, 7, 11, 2)
        .filter((row) => row.section_id === 11)
        .map((row) => row.inuksuk_id),
    ).toEqual([8, 9, 7])
    expect(
      moveBoardMember(board, 7, 12, 0)
        .filter((row) => row.section_id === 12)
        .map((row) => row.inuksuk_id),
    ).toEqual([7, 10, 11])
  })
})
