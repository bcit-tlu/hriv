import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ApiImage } from '../../src/api'

const apiMocks = vi.hoisted(() => ({
  fetchImage: vi.fn(),
}))

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchImage: apiMocks.fetchImage,
  }
})

import RenewingThumbnail from '../../src/components/RenewingThumbnail'
import { resetTileTokenRenewalCacheForTests } from '../../src/tileTokenRenewal'

function apiImage(overrides: Partial<ApiImage> = {}): ApiImage {
  return {
    id: 1,
    name: 'Slide',
    thumb: '/thumb-stale.jpg',
    tile_sources: '/tiles.dzi',
    category_id: null,
    copyright: null,
    note: null,
    active: true,
    sort_order: 0,
    metadata_extra: null,
    version: 1,
    width: null,
    height: null,
    file_size: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('RenewingThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTileTokenRenewalCacheForTests()
  })

  afterEach(() => {
    resetTileTokenRenewalCacheForTests()
  })

  it('swaps to a freshly tokenized thumbnail after an image load error', async () => {
    apiMocks.fetchImage.mockResolvedValue(apiImage({ thumb: '/thumb.jpg?tile_token=fresh' }))
    const onImageRenewed = vi.fn()
    render(
      <RenewingThumbnail
        image={{ id: 1, thumb: '/thumb.jpg?tile_token=stale' }}
        alt="Slide"
        onImageRenewed={onImageRenewed}
      />,
    )

    fireEvent.error(screen.getByAltText('Slide'))

    await waitFor(() =>
      expect(screen.getByAltText('Slide')).toHaveAttribute('src', '/thumb.jpg?tile_token=fresh'),
    )
    expect(apiMocks.fetchImage).toHaveBeenCalledWith(1)
    expect(onImageRenewed).toHaveBeenCalledWith(
      expect.objectContaining({ thumb: '/thumb.jpg?tile_token=fresh' }),
    )
  })

  it('leaves the broken URL in place after a failed renewal and does not retry the same stale URL', async () => {
    apiMocks.fetchImage.mockRejectedValue(new Error('forbidden'))
    render(<RenewingThumbnail image={{ id: 1, thumb: '/thumb-stale.jpg' }} alt="Slide" />)
    const img = screen.getByAltText('Slide')

    fireEvent.error(img)
    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1))
    fireEvent.error(img)

    expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1)
    expect(img).toHaveAttribute('src', '/thumb-stale.jpg')
  })

  it('deduplicates a burst of errors into one renewal request', async () => {
    const renewal = deferred<ApiImage>()
    apiMocks.fetchImage.mockReturnValue(renewal.promise)
    render(<RenewingThumbnail image={{ id: 1, thumb: '/thumb-stale.jpg' }} alt="Slide" />)
    const img = screen.getByAltText('Slide')

    fireEvent.error(img)
    fireEvent.error(img)
    fireEvent.error(img)

    expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1)
    await act(async () => {
      renewal.resolve(apiImage({ thumb: '/thumb-fresh.jpg' }))
      await renewal.promise
    })
    expect(img).toHaveAttribute('src', '/thumb-fresh.jpg')
  })

  it('allows a new image prop to renew independently after the previous URL was retried', async () => {
    apiMocks.fetchImage
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce(apiImage({ id: 2, thumb: '/thumb-2-fresh.jpg' }))
    const { rerender } = render(
      <RenewingThumbnail image={{ id: 1, thumb: '/thumb-1-stale.jpg' }} alt="Slide" />,
    )
    fireEvent.error(screen.getByAltText('Slide'))
    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledTimes(1))

    rerender(<RenewingThumbnail image={{ id: 2, thumb: '/thumb-2-stale.jpg' }} alt="Slide" />)
    const img = screen.getByAltText('Slide')
    expect(img).toHaveAttribute('src', '/thumb-2-stale.jpg')
    fireEvent.error(img)

    await waitFor(() => expect(apiMocks.fetchImage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(img).toHaveAttribute('src', '/thumb-2-fresh.jpg'))
  })

  it('ignores a stale renewal that completes after props change', async () => {
    const first = deferred<ApiImage>()
    apiMocks.fetchImage.mockReturnValue(first.promise)
    const onImageRenewed = vi.fn()
    const { rerender } = render(
      <RenewingThumbnail
        image={{ id: 1, thumb: '/thumb-1-stale.jpg' }}
        alt="Slide"
        onImageRenewed={onImageRenewed}
      />,
    )
    fireEvent.error(screen.getByAltText('Slide'))

    rerender(
      <RenewingThumbnail
        image={{ id: 2, thumb: '/thumb-2-stale.jpg' }}
        alt="Slide"
        onImageRenewed={onImageRenewed}
      />,
    )
    await act(async () => {
      first.resolve(apiImage({ id: 1, thumb: '/thumb-1-fresh.jpg' }))
      await first.promise
    })

    expect(screen.getByAltText('Slide')).toHaveAttribute('src', '/thumb-2-stale.jpg')
    expect(onImageRenewed).not.toHaveBeenCalled()
  })

  it('ignores a stale renewal that completes after unmount', async () => {
    const renewal = deferred<ApiImage>()
    apiMocks.fetchImage.mockReturnValue(renewal.promise)
    const onImageRenewed = vi.fn()
    const { unmount } = render(
      <RenewingThumbnail
        image={{ id: 1, thumb: '/thumb-stale.jpg' }}
        alt="Slide"
        onImageRenewed={onImageRenewed}
      />,
    )
    fireEvent.error(screen.getByAltText('Slide'))
    unmount()

    await act(async () => {
      renewal.resolve(apiImage({ thumb: '/thumb-fresh.jpg' }))
      await renewal.promise
    })

    expect(onImageRenewed).not.toHaveBeenCalled()
  })
})
