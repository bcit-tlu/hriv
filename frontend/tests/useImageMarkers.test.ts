import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageMarkers } from '../src/useImageMarkers'
import { MARKER_FIXTURE } from '../src/components/markerFixtures'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../src/api', () => ({
  fetchImageMarkers: mocks.fetch,
  userMessage: () => 'Unable to load Markers',
}))
beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue([])
})
describe('useImageMarkers', () => {
  it('never fetches without the flag or an image id', () => {
    const { rerender } = renderHook(({ id, enabled }) => useImageMarkers(id, enabled), {
      initialProps: { id: undefined as number | undefined, enabled: true },
    })
    rerender({ id: 42, enabled: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('loads through the image endpoint and refetches after changes', async () => {
    mocks.fetch.mockResolvedValueOnce([MARKER_FIXTURE]).mockResolvedValueOnce([])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.items).toEqual([MARKER_FIXTURE]))
    await act(() => result.current.reload())
    expect(result.current.items).toEqual([])
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, 42)
  })
  it('keeps own and instructor groups but excludes public views from all viewer consumers', async () => {
    const instructor = { ...MARKER_FIXTURE, id: 8, source: 'instructor' as const }
    const publicView = { ...MARKER_FIXTURE, id: 9, source: 'public' as const }
    mocks.fetch.mockResolvedValue([MARKER_FIXTURE, instructor, publicView])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.items).toEqual([MARKER_FIXTURE, instructor]))
    mocks.fetch.mockResolvedValue([publicView])
    await act(() => result.current.reload())
    expect(result.current.items).toEqual([])
  })
  it('discards an old image response, hides old records immediately and surfaces failures', async () => {
    let resolve!: (value: unknown) => void
    mocks.fetch
      .mockReturnValueOnce(
        new Promise((r) => {
          resolve = r
        }),
      )
      .mockRejectedValueOnce(new Error('network'))
    const { result, rerender } = renderHook(({ id }) => useImageMarkers(id, true), {
      initialProps: { id: 42 },
    })
    rerender({ id: 43 })
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(result.current.error).toBe('Unable to load Markers'))
    await act(async () => resolve([MARKER_FIXTURE]))
    expect(result.current.items).toEqual([])
  })
})
