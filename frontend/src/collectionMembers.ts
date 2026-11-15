import type { CollectionMember } from './types'
import type { CollectionSlotInput } from './api'
import { fetchCollection, fetchInuksuk } from './api'

export function memberKey(image: CollectionMember): number {
  return image.draftKey ?? image.slot?.id ?? image.id
}

export function memberSlotInput(
  image: Pick<CollectionMember, 'id' | 'slot' | 'inuksukId'>,
): CollectionSlotInput {
  if (image.inuksukId != null) return { image_id: image.id, inuksuk_id: image.inuksukId }
  return { ...(image.slot && image.slot.id > 0 ? { id: image.slot.id } : {}), image_id: image.id }
}

export function memberViewport(image: CollectionMember, legacy: Record<string, unknown>): unknown {
  return image.slot?.viewport_state ?? legacy[String(image.id)]
}

export async function renewSlotThumbnail(collectionId: number, image: CollectionMember) {
  if (image.inuksukId != null) {
    const fresh = await fetchInuksuk(image.inuksukId)
    return { id: image.id, thumb: fresh.thumb }
  }
  const fresh = await fetchCollection(collectionId)
  const member = fresh.images.find(
    (member) => image.slot != null && member.slot?.id === image.slot.id,
  )
  return {
    id: image.id,
    thumb: member?.slot?.thumb ?? member?.thumb ?? null,
  }
}
