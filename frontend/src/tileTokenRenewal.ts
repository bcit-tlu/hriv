import { fetchImage, type ApiImage } from './api'
import type { ImageItem } from './types'

const inFlightRenewals = new Map<number, Promise<ApiImage>>()

interface TileFailureEvent {
  message?: string
  tileRequest?: { status?: number } | null
}

export function renewImageRecord(imageId: number): Promise<ApiImage> {
  const existing = inFlightRenewals.get(imageId)
  if (existing) return existing

  const renewal = fetchImage(imageId).finally(() => {
    inFlightRenewals.delete(imageId)
  })
  inFlightRenewals.set(imageId, renewal)
  return renewal
}

export function isTileTokenAuthorizationFailure(
  event?: TileFailureEvent,
  allowUnknownStatus = false,
): boolean {
  const status = event?.tileRequest?.status
  if (status && status !== 0) return status === 401 || status === 403

  const statusMatch = /^HTTP (\d{3})\b/.exec(event?.message?.trim() ?? '')
  if (statusMatch) return statusMatch[1] === '401' || statusMatch[1] === '403'

  return allowUnknownStatus
}

export function mergeRenewedApiImageUrls(current: ApiImage, renewed: ApiImage): ApiImage {
  return {
    ...current,
    thumb: renewed.thumb,
    tile_sources: renewed.tile_sources,
  }
}

export function mergeRenewedImageItemUrls(current: ImageItem, renewed: ApiImage): ImageItem {
  return {
    ...current,
    thumb: renewed.thumb,
    tileSources: renewed.tile_sources,
  }
}

export function resetTileTokenRenewalCacheForTests() {
  inFlightRenewals.clear()
}
