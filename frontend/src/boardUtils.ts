import type { ApiBoard, ApiBoardSummary, ApiMarker, User } from './types'

export function ownsBoard(board: ApiBoardSummary, user: User | null): boolean {
  return (
    user != null &&
    (board.owners.some((owner) => owner.user_id === user.id) ||
      (board.owner_program_id != null && user.program_ids.includes(board.owner_program_id)))
  )
}

export function moveBoardMember(board: ApiBoard, id: number, index: number) {
  const ids = board.markers.filter((item) => item.id !== id).map((item) => item.id)
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
  return ids.map((marker_id) => ({ marker_id }))
}

export function markerViewParams(item: ApiMarker): Record<string, string> {
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
  return { boardId }
}
