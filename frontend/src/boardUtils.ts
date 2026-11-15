import type { ApiBoard, ApiBoardSummary, ApiInuksuk, User } from './types'

export function ownsBoard(board: ApiBoardSummary, user: User | null): boolean {
  return (
    user != null &&
    (board.owners.some((owner) => owner.user_id === user.id) ||
      (board.owner_program_id != null && user.program_ids.includes(board.owner_program_id)))
  )
}

export function groupBoardMembers(board: ApiBoard) {
  return [...board.sections, { id: null, name: 'Unsectioned' }].map((section) => ({
    ...section,
    inuksuks: board.inuksuks.filter((item) => item.section_id === section.id),
  }))
}

export function boardMemberOrder(board: ApiBoard, ids: number[], sectionId: number | null) {
  const moved = new Set(ids)
  return [
    ...board.inuksuks
      .filter((item) => !moved.has(item.id))
      .map((item) => ({ inuksuk_id: item.id, section_id: item.section_id })),
    ...ids.map((inuksuk_id) => ({ inuksuk_id, section_id: sectionId })),
  ]
}

export function moveBoardMember(
  board: ApiBoard,
  id: number,
  sectionId: number | null,
  index: number,
) {
  const ids = board.inuksuks
    .filter((item) => item.section_id === sectionId && item.id !== id)
    .map((item) => item.id)
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
  return boardMemberOrder(board, ids, sectionId)
}

export function inuksukViewParams(item: ApiInuksuk): Record<string, string> {
  return {
    image: String(item.image_id),
    x: String(item.x),
    y: String(item.y),
    zoom: String(item.zoom),
    rotation: String(item.rotation),
  }
}

export function parseBoardLocation(search: string) {
  const params = new URLSearchParams(search)
  const id = (key: string) => {
    const value = Number(params.get(key))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  const boardId = params.get('page') === 'boards' ? id('board') : null
  return { boardId, sectionId: boardId == null ? null : id('section') }
}
