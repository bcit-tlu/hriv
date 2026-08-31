import { fetchImage, type ApiImage } from './api'

const inFlightRenewals = new Map<number, Promise<ApiImage>>()

export function renewImageRecord(imageId: number): Promise<ApiImage> {
  const existing = inFlightRenewals.get(imageId)
  if (existing) return existing

  const renewal = fetchImage(imageId).finally(() => {
    inFlightRenewals.delete(imageId)
  })
  inFlightRenewals.set(imageId, renewal)
  return renewal
}

export function resetTileTokenRenewalCacheForTests() {
  inFlightRenewals.clear()
}
