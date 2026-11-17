import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageInuksuks } from '../src/useImageInuksuks'
import { INUKSUK_FIXTURE } from '../src/components/inuksukFixtures'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../src/api', () => ({
  fetchImageInuksuks: mocks.fetch,
  userMessage: () => 'Unable to load Inuksuks',
}))
beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue([])
})
describe('useImageInuksuks', () => {
  it('never fetches without the flag or an image id', () => {
    const { rerender } = renderHook(({ id, enabled }) => useImageInuksuks(id, enabled), {
      initialProps: { id: undefined as number | undefined, enabled: true },
    })
    rerender({ id: 42, enabled: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('loads through the image endpoint and refetches after changes', async () => {
    mocks.fetch.mockResolvedValueOnce([INUKSUK_FIXTURE]).mockResolvedValueOnce([])
    const { result } = renderHook(() => useImageInuksuks(42, true))
    await waitFor(() => expect(result.current.items).toEqual([INUKSUK_FIXTURE]))
    await act(() => result.current.reload())
    expect(result.current.items).toEqual([])
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, 42)
  })
  it('keeps own and instructor groups but excludes public views from all viewer consumers', async () => {
    const instructor = { ...INUKSUK_FIXTURE, id: 8, source: 'instructor' as const }
    const publicView = { ...INUKSUK_FIXTURE, id: 9, source: 'public' as const }
    mocks.fetch.mockResolvedValue([INUKSUK_FIXTURE, instructor, publicView])
    const { result } = renderHook(() => useImageInuksuks(42, true))
    await waitFor(() => expect(result.current.items).toEqual([INUKSUK_FIXTURE, instructor]))
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
    const { result, rerender } = renderHook(({ id }) => useImageInuksuks(id, true), {
      initialProps: { id: 42 },
    })
    rerender({ id: 43 })
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(result.current.error).toBe('Unable to load Inuksuks'))
    await act(async () => resolve([INUKSUK_FIXTURE]))
    expect(result.current.items).toEqual([])
  })
})
