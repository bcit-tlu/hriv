import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiImage } from '../src/api'
import type { ImageItem } from '../src/types'

const apiMocks = vi.hoisted(() => ({
  fetchImage: vi.fn(),
}))

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  fetchImage: apiMocks.fetchImage,
}))

import {
  isTileTokenAuthorizationFailure,
  mergeRenewedApiImageUrls,
  mergeRenewedImageItemUrls,
  renewImageRecord,
  resetTileTokenRenewalCacheForTests,
} from '../src/tileTokenRenewal'

const apiImage = (overrides: Partial<ApiImage> = {}): ApiImage => ({
  id: 1,
  name: 'Current name',
  thumb: '/thumb.jpg?tile_token=old',
  tile_sources: '/image.dzi?tile_token=old',
  category_id: 2,
  copyright: 'Current copyright',
  note: 'Current note',
  active: true,
  sort_order: 3,
  metadata_extra: { current: true },
  version: 9,
  width: 100,
  height: 200,
  file_size: 300,
  created_at: 'created',
  updated_at: 'updated',
  ...overrides,
})

describe('tile token renewal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTileTokenRenewalCacheForTests()
  })

  it('deduplicates concurrent image refreshes', async () => {
    apiMocks.fetchImage.mockResolvedValue(apiImage())

    const first = renewImageRecord(1)
    const second = renewImageRecord(1)

    expect(first).toBe(second)
    await expect(first).resolves.toEqual(apiImage())
    expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1)
  })

  it('recognizes only 401 and 403 tile failures as renewal candidates', () => {
    expect(isTileTokenAuthorizationFailure({ tileRequest: { status: 401 } })).toBe(true)
    expect(isTileTokenAuthorizationFailure({ message: 'HTTP 403 loading image.dzi' })).toBe(true)
    expect(isTileTokenAuthorizationFailure({ tileRequest: { status: 404 } })).toBe(false)
    expect(
      isTileTokenAuthorizationFailure({
        message: 'HTTP 404 attempting to load TileSource: /api/tiles/403/image.dzi',
      }),
    ).toBe(false)
    expect(isTileTokenAuthorizationFailure({ message: 'Malformed DZI descriptor' })).toBe(false)
    expect(
      isTileTokenAuthorizationFailure(
        {
          message: '[downloadTileStart] Image load aborted or errored out.',
          tileRequest: null,
        },
        true,
      ),
    ).toBe(true)
  })

  it('merges only renewed URLs into API image state', () => {
    const current = apiImage()
    const renewed = apiImage({
      name: 'Stale name',
      thumb: '/thumb.jpg?tile_token=fresh',
      tile_sources: '/image.dzi?tile_token=fresh',
      version: 8,
    })

    expect(mergeRenewedApiImageUrls(current, renewed)).toEqual({
      ...current,
      thumb: renewed.thumb,
      tile_sources: renewed.tile_sources,
    })
  })

  it('merges only renewed URLs into browse image state', () => {
    const current: ImageItem = {
      id: 1,
      name: 'Current name',
      thumb: '/thumb.jpg?tile_token=old',
      tileSources: '/image.dzi?tile_token=old',
      categoryId: 2,
      copyright: 'Current copyright',
      note: 'Current note',
      active: true,
      sortOrder: 3,
      metadataExtra: { current: true },
      version: 9,
    }
    const renewed = apiImage({
      name: 'Stale name',
      thumb: '/thumb.jpg?tile_token=fresh',
      tile_sources: '/image.dzi?tile_token=fresh',
      version: 8,
    })

    expect(mergeRenewedImageItemUrls(current, renewed)).toEqual({
      ...current,
      thumb: renewed.thumb,
      tileSources: renewed.tile_sources,
    })
  })
})
