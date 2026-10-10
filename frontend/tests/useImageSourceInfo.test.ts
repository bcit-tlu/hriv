import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchImageSourceInfo } from '../src/api'
import type { ImageSourceInfo } from '../src/types'
import { useImageSourceInfo } from '../src/useImageSourceInfo'

vi.mock('../src/api', () => ({
  fetchImageSourceInfo: vi.fn(),
}))

const fetchSourceInfo = vi.mocked(fetchImageSourceInfo)
const sourceInfo: ImageSourceInfo = {
  originalFilename: 'scan.tif',
  fileType: 'TIF',
  uploadedByName: 'Image Uploader',
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useImageSourceInfo', () => {
  it('does not fetch while disabled', () => {
    const { result } = renderHook(() => useImageSourceInfo(1, 1, false))

    expect(fetchSourceInfo).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('fetches source information when enabled', async () => {
    fetchSourceInfo.mockResolvedValue(sourceInfo)
    const { result } = renderHook(() => useImageSourceInfo(1, 1, true))

    await waitFor(() => expect(result.current).toEqual(sourceInfo))
    expect(fetchSourceInfo).toHaveBeenCalledTimes(1)
    expect(fetchSourceInfo).toHaveBeenCalledWith(1)
  })

  it('does not refetch when collapsing and re-expanding the same image', async () => {
    let resolveRequest: (value: ImageSourceInfo) => void = () => undefined
    fetchSourceInfo.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useImageSourceInfo(1, 1, enabled),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => expect(fetchSourceInfo).toHaveBeenCalledTimes(1))
    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(fetchSourceInfo).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRequest(sourceInfo)
    })
    await waitFor(() => expect(result.current).toEqual(sourceInfo))

    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(result.current).toEqual(sourceInfo)
    expect(fetchSourceInfo).toHaveBeenCalledTimes(1)
  })

  it('refetches when the image version changes', async () => {
    fetchSourceInfo.mockResolvedValueOnce(sourceInfo).mockResolvedValueOnce({
      ...sourceInfo,
      originalFilename: 'replacement.tif',
    })
    const { result, rerender } = renderHook(
      ({ version }: { version: number }) => useImageSourceInfo(1, version, true),
      { initialProps: { version: 1 } },
    )

    await waitFor(() => expect(result.current).toEqual(sourceInfo))
    rerender({ version: 2 })
    await waitFor(() =>
      expect(result.current).toEqual({
        ...sourceInfo,
        originalFilename: 'replacement.tif',
      }),
    )
    expect(fetchSourceInfo).toHaveBeenNthCalledWith(1, 1)
    expect(fetchSourceInfo).toHaveBeenNthCalledWith(2, 1)
  })

  it('does not display a stale response after the key changes', async () => {
    let resolveOld: (value: ImageSourceInfo) => void = () => undefined
    const oldRequest = new Promise<ImageSourceInfo>((resolve) => {
      resolveOld = resolve
    })
    const newerInfo = { ...sourceInfo, originalFilename: 'new.tif' }
    fetchSourceInfo.mockReturnValueOnce(oldRequest).mockResolvedValueOnce(newerInfo)

    const { result, rerender } = renderHook(
      ({ imageId }: { imageId: number }) => useImageSourceInfo(imageId, 1, true),
      { initialProps: { imageId: 1 } },
    )

    rerender({ imageId: 2 })
    await waitFor(() => expect(result.current).toEqual(newerInfo))

    await act(async () => {
      resolveOld(sourceInfo)
    })
    expect(result.current).toEqual(newerInfo)
  })

  it('retries a failed request after collapse and re-expand', async () => {
    let rejectRequest: (reason: Error) => void = () => undefined
    fetchSourceInfo
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectRequest = reject
        }),
      )
      .mockResolvedValueOnce(sourceInfo)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useImageSourceInfo(1, 1, enabled),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => expect(fetchSourceInfo).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()

    await act(async () => {
      rejectRequest(new Error('request failed'))
      await Promise.resolve()
    })
    expect(result.current).toBeNull()

    rerender({ enabled: false })
    rerender({ enabled: true })
    await waitFor(() => expect(fetchSourceInfo).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current).toEqual(sourceInfo))
  })
})
