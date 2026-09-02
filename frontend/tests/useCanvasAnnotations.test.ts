import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasAnnotations } from '../src/useCanvasAnnotations'
import type { UseCanvasAnnotationsDeps } from '../src/useCanvasAnnotations'
import type { CanvasAnnotation } from '../src/components/CanvasOverlay'
import * as api from '../src/api'
import { makeImage } from './helpers/fixtures'

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../src/api')
  return {
    ...actual,
    updateImage: vi.fn(),
  }
})

const mockUpdateImage = vi.mocked(api.updateImage)

function makeDeps(overrides: Partial<UseCanvasAnnotationsDeps> = {}): UseCanvasAnnotationsDeps {
  return {
    selectedImage: null,
    fetchImage: vi.fn().mockResolvedValue({ version: 1, metadata_extra: null }),
    loadCategories: vi.fn().mockResolvedValue(undefined),
    loadUncategorizedImages: vi.fn(),
    setErrorSnack: vi.fn(),
    ...overrides,
  }
}

let annotationCounter = 0
function makeAnnotation(overrides: Partial<CanvasAnnotation> = {}): CanvasAnnotation {
  annotationCounter += 1
  return {
    id: `test-${annotationCounter}`,
    type: 'rect',
    vpX: 0,
    vpY: 0,
    vpWidth: 0.1,
    vpHeight: 0.1,
    color: '#ff0000',
    ...overrides,
  }
}

function responseLostError(): api.ApiTransportError {
  return new api.ApiTransportError('Network error', { method: 'PATCH', path: '/images/1' })
}

describe('useCanvasAnnotations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUpdateImage.mockReset()
    annotationCounter = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('returns empty canvasAnnotations when no image selected', () => {
      const deps = makeDeps()
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      expect(result.current.canvasAnnotations).toEqual([])
      expect(result.current.localCanvasAnnotations).toBeNull()
    })

    it('extracts canvas annotations from selectedImage metadata', () => {
      const annotations = [makeAnnotation()]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: annotations } })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      expect(result.current.canvasAnnotations).toEqual(annotations)
    })

    it('returns empty array when metadata has no canvas_annotations', () => {
      const image = makeImage({ id: 1, metadataExtra: { some_other: 'data' } })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      expect(result.current.canvasAnnotations).toEqual([])
    })

    it('returns empty array when metadataExtra is null', () => {
      const image = makeImage({ id: 1, metadataExtra: null })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      expect(result.current.canvasAnnotations).toEqual([])
    })
  })

  describe('handleCanvasAnnotationsChange', () => {
    it('updates localCanvasAnnotations immediately', () => {
      const image = makeImage({ id: 1 })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))
      const annotations = [makeAnnotation()]

      act(() => {
        result.current.handleCanvasAnnotationsChange(annotations)
      })

      expect(result.current.localCanvasAnnotations).toEqual(annotations)
    })

    it('debounces the save by 600ms', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/thumb/1.jpg',
        tile_sources: '/tiles/1',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: { canvas_annotations: [makeAnnotation()] },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))
      const annotations = [makeAnnotation()]

      act(() => {
        result.current.handleCanvasAnnotationsChange(annotations)
      })

      // Not saved yet
      expect(mockUpdateImage).not.toHaveBeenCalled()

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()
      expect(mockUpdateImage).toHaveBeenCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: annotations } },
        1,
      )
    })

    it('resets debounce timer on rapid edits', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/thumb/1.jpg',
        tile_sources: '/tiles/1',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))
      const first = [makeAnnotation({ vpX: 0.1 })]
      const second = [makeAnnotation({ vpX: 0.2 })]

      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })

      // Advance 400ms (not past debounce yet)
      act(() => {
        vi.advanceTimersByTime(400)
      })

      // Second edit resets the timer
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })

      // Advance another 400ms — first timer would have fired but was reset
      act(() => {
        vi.advanceTimersByTime(400)
      })

      expect(mockUpdateImage).not.toHaveBeenCalled()

      // Advance remaining 200ms to complete second timer
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()
      // Should save the second (latest) annotations
      expect(mockUpdateImage).toHaveBeenCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: second } },
        1,
      )
    })

    it('keeps a stable identity across rerenders', () => {
      const image = makeImage({ id: 1 })
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )
      const firstIdentity = result.current.handleCanvasAnnotationsChange

      rerender(makeDeps({ selectedImage: image }))

      expect(result.current.handleCanvasAnnotationsChange).toBe(firstIdentity)
    })

    it('fires the latest save closure when deps change during the debounce window', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/thumb/1.jpg',
        tile_sources: '/tiles/1',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const staleLoadCategories = vi.fn().mockResolvedValue(undefined)
      const freshLoadCategories = vi.fn().mockResolvedValue(undefined)
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image, loadCategories: staleLoadCategories }) },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })

      // Recreate saveCanvasAnnotations mid-debounce (same image, so the timer survives)
      rerender(makeDeps({ selectedImage: image, loadCategories: freshLoadCategories }))

      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()
      expect(staleLoadCategories).not.toHaveBeenCalled()
      expect(freshLoadCategories).toHaveBeenCalledOnce()
    })

    it('queues data when a save is in-flight', async () => {
      const image = makeImage({ id: 1 })
      let resolveFirst!: (value: unknown) => void
      const firstPromise = new Promise((r) => {
        resolveFirst = r
      })
      mockUpdateImage.mockReturnValueOnce(firstPromise as never).mockResolvedValueOnce({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 3,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))
      const first = [makeAnnotation({ vpX: 0.1 })]
      const second = [makeAnnotation({ vpX: 0.2 })]

      // Trigger first save
      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()

      // While first is in-flight, make another change
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })

      // Resolve first save
      await act(async () => {
        resolveFirst({
          id: 1,
          name: 'img-1',
          thumb: '/t',
          tile_sources: '/s',
          category_id: null,
          copyright: null,
          note: null,
          active: true,
          sort_order: 0,
          version: 2,
          metadata_extra: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          width: null,
          height: null,
          file_size: null,
        })
      })

      // Queued save should fire
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
    })

    it('reconciles an indeterminate save before retrying queued edits', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const first = [makeAnnotation({ id: 'first' })]
      const second = [makeAnnotation({ id: 'second' })]
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      mockUpdateImage
        .mockReturnValueOnce(firstSave as never)
        .mockResolvedValueOnce(
          makeImage({ id: 1, version: 3, metadataExtra: { canvas_annotations: second } }),
        )
      const fetchImage = vi.fn().mockResolvedValue({
        version: 2,
        metadata_extra: { canvas_annotations: first },
      })
      const { result } = renderHook(() =>
        useCanvasAnnotations(makeDeps({ selectedImage: image, fetchImage })),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })

      rejectFirst(responseLostError())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchImage).toHaveBeenCalledWith(1)
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: second } },
        2,
      )
    })

    it('reconciles an uncertain autosave before a later canvas edit', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const edited = [makeAnnotation({ id: 'edited' })]
      const later = [makeAnnotation({ id: 'later' })]
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      mockUpdateImage
        .mockReturnValueOnce(firstSave as never)
        .mockResolvedValueOnce(
          makeImage({ id: 1, version: 3, metadataExtra: { canvas_annotations: later } }),
        )
      const fetchImage = vi.fn().mockResolvedValue({
        version: 2,
        metadata_extra: { canvas_annotations: edited },
      })
      const { result } = renderHook(() =>
        useCanvasAnnotations(makeDeps({ selectedImage: image, fetchImage })),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      rejectFirst(responseLostError())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      act(() => {
        result.current.handleCanvasAnnotationsChange(later)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchImage).toHaveBeenCalledWith(1)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: later } },
        2,
      )
    })

    it('does not retry queued edits after a definitive conflict', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const first = [makeAnnotation({ id: 'first' })]
      const second = [makeAnnotation({ id: 'second' })]
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      mockUpdateImage.mockReturnValueOnce(firstSave as never)
      const fetchImage = vi.fn()
      const { result } = renderHook(() =>
        useCanvasAnnotations(makeDeps({ selectedImage: image, fetchImage })),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })
      rejectFirst(new api.ApiError(409, 'This item was modified by another user.'))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchImage).not.toHaveBeenCalled()
      expect(mockUpdateImage).toHaveBeenCalledOnce()
    })

    it('resumes saving after a newer same-image refresh resolves a conflict', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const conflictedEdit = [makeAnnotation({ id: 'conflicted' })]
      const authoritative = [makeAnnotation({ id: 'authoritative' })]
      const laterEdit = [makeAnnotation({ id: 'later' })]
      mockUpdateImage
        .mockRejectedValueOnce(new api.ApiError(409, 'This item was modified by another user.'))
        .mockResolvedValueOnce(
          makeImage({ id: 1, version: 3, metadataExtra: { canvas_annotations: laterEdit } }),
        )
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(conflictedEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        await Promise.resolve()
        await Promise.resolve()
      })
      rerender(
        makeDeps({
          selectedImage: makeImage({
            id: 1,
            version: 2,
            metadataExtra: { canvas_annotations: authoritative },
          }),
        }),
      )

      expect(result.current.localCanvasAnnotations).toBeNull()
      expect(result.current.latestVersionRef.current).toBe(2)
      act(() => {
        result.current.handleCanvasAnnotationsChange(laterEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: laterEdit } },
        2,
      )
    })

    it('resumes saving after navigating back to newer authoritative image data', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const otherImage = makeImage({ id: 2, version: 1 })
      const conflictedEdit = [makeAnnotation({ id: 'conflicted' })]
      const authoritative = [makeAnnotation({ id: 'authoritative' })]
      const laterEdit = [makeAnnotation({ id: 'later' })]
      mockUpdateImage
        .mockRejectedValueOnce(new api.ApiError(409, 'This item was modified by another user.'))
        .mockResolvedValueOnce(
          makeImage({ id: 1, version: 3, metadataExtra: { canvas_annotations: laterEdit } }),
        )
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(conflictedEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        await Promise.resolve()
        await Promise.resolve()
      })
      rerender(makeDeps({ selectedImage: otherImage }))
      rerender(
        makeDeps({
          selectedImage: makeImage({
            id: 1,
            version: 2,
            metadataExtra: { canvas_annotations: authoritative },
          }),
        }),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(laterEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: laterEdit } },
        2,
      )
    })

    it('discards a debounced edit when navigating to another image', async () => {
      const firstImage = makeImage({ id: 1 })
      const secondImage = makeImage({ id: 2 })
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: firstImage }) },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      rerender(makeDeps({ selectedImage: secondImage }))
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).not.toHaveBeenCalled()
    })

    it('discards queued edits when navigating away during a save', async () => {
      const firstImage = makeImage({ id: 1 })
      const secondImage = makeImage({ id: 2 })
      const first = [makeAnnotation({ id: 'first' })]
      const second = [makeAnnotation({ id: 'second' })]
      let resolveFirst!: (value: ImageItem) => void
      const firstSave = new Promise<ImageItem>((resolve) => {
        resolveFirst = resolve
      })
      mockUpdateImage.mockReturnValueOnce(firstSave as never)
      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: firstImage }) },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })
      rerender(makeDeps({ selectedImage: secondImage }))
      resolveFirst(makeImage({ id: 1, version: 2, metadataExtra: { canvas_annotations: first } }))
      await act(async () => {
        await Promise.resolve()
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()
    })

    it('preserves the in-flight save when the same image is refreshed', async () => {
      const image = makeImage({ id: 1, version: 1 })
      let resolveFirst!: (value: unknown) => void
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })
      const firstUpdate = {
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      }
      mockUpdateImage.mockReturnValueOnce(firstPromise as never).mockResolvedValueOnce({
        ...firstUpdate,
        version: 3,
      })

      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )
      const first = [makeAnnotation({ vpX: 0.1 })]
      const second = [makeAnnotation({ vpX: 0.2 })]

      act(() => {
        result.current.handleCanvasAnnotationsChange(first)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockUpdateImage).toHaveBeenCalledOnce()

      // Tile-token renewal replaces the selected image object without changing
      // the image ID. It must not discard the annotation save's CAS state.
      rerender(
        makeDeps({
          selectedImage: makeImage({ id: 1, version: 1, tileSources: '/renewed-s' }),
        }),
      )
      act(() => {
        result.current.handleCanvasAnnotationsChange(second)
      })

      resolveFirst(firstUpdate)
      await act(async () => {
        await Promise.resolve()
      })

      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: second } },
        2,
      )
    })

    it('uses a newer same-image version without clearing the pending save', async () => {
      const image = makeImage({ id: 1, version: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 3,
        metadata_extra: { source: 'newer-image-update' },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })

      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )
      const annotations = [makeAnnotation()]

      act(() => {
        result.current.handleCanvasAnnotationsChange(annotations)
      })
      rerender(
        makeDeps({
          selectedImage: makeImage({
            id: 1,
            version: 3,
            metadataExtra: { source: 'newer-image-update' },
          }),
        }),
      )

      expect(result.current.latestVersionRef.current).toBe(3)
      expect(result.current.latestMetadataRef.current).toEqual({ source: 'newer-image-update' })

      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: annotations } },
        3,
      )
    })

    it('does not let an older save response replace newer image metadata', async () => {
      const image = makeImage({ id: 1, version: 1 })
      let resolveSave!: (value: unknown) => void
      const savePromise = new Promise((resolve) => {
        resolveSave = resolve
      })
      mockUpdateImage.mockReturnValue(savePromise as never)

      const { result, rerender } = renderHook(
        (deps: UseCanvasAnnotationsDeps) => useCanvasAnnotations(deps),
        { initialProps: makeDeps({ selectedImage: image }) },
      )
      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      rerender(
        makeDeps({
          selectedImage: makeImage({
            id: 1,
            version: 3,
            metadataExtra: { source: 'newer-image-update' },
          }),
        }),
      )
      resolveSave({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: { source: 'older-annotation-response' },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.latestVersionRef.current).toBe(3)
      expect(result.current.latestMetadataRef.current).toEqual({ source: 'newer-image-update' })
    })
  })

  describe('flushCanvasAnnotations', () => {
    it('bypasses debounce timer and saves immediately', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))
      const annotations = [makeAnnotation()]

      // Set annotations (starts debounce timer)
      act(() => {
        result.current.handleCanvasAnnotationsChange(annotations)
      })

      expect(mockUpdateImage).not.toHaveBeenCalled()

      // Flush bypasses the timer
      await act(async () => {
        await result.current.flushCanvasAnnotations()
      })

      expect(mockUpdateImage).toHaveBeenCalledOnce()
    })

    it('is a no-op when no pending changes exist', async () => {
      const image = makeImage({ id: 1 })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      await act(async () => {
        await result.current.flushCanvasAnnotations()
      })

      expect(mockUpdateImage).not.toHaveBeenCalled()
    })

    it('awaits an in-flight save without relying on a timeout', async () => {
      const image = makeImage({ id: 1 })
      const annotations = [makeAnnotation()]
      let resolveSave!: (value: ImageItem) => void
      const save = new Promise<ImageItem>((resolve) => {
        resolveSave = resolve
      })
      mockUpdateImage.mockReturnValueOnce(save as never)
      const { result } = renderHook(() => useCanvasAnnotations(makeDeps({ selectedImage: image })))

      act(() => {
        result.current.handleCanvasAnnotationsChange(annotations)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      let flushed = false
      const flush = result.current.flushCanvasAnnotations().then(() => {
        flushed = true
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(flushed).toBe(false)

      resolveSave(
        makeImage({ id: 1, version: 2, metadataExtra: { canvas_annotations: annotations } }),
      )
      await act(async () => {
        await flush
      })

      expect(flushed).toBe(true)
    })

    it('reconciles an uncertain autosave before Save and Exit retries it', async () => {
      const image = makeImage({ id: 1, version: 1 })
      const edited = [makeAnnotation({ id: 'edited' })]
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      mockUpdateImage
        .mockReturnValueOnce(firstSave as never)
        .mockResolvedValueOnce(
          makeImage({ id: 1, version: 3, metadataExtra: { canvas_annotations: edited } }),
        )
      const fetchImage = vi.fn().mockResolvedValue({
        version: 2,
        metadata_extra: { canvas_annotations: edited },
      })
      const { result } = renderHook(() =>
        useCanvasAnnotations(makeDeps({ selectedImage: image, fetchImage })),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      rejectFirst(responseLostError())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        await result.current.flushCanvasAnnotations()
      })

      expect(fetchImage).toHaveBeenCalledWith(1)
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: edited } },
        2,
      )
    })
  })

  describe('cancelCanvasAnnotations', () => {
    it('discards a debounced edit without issuing a save', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation({ id: 'edited' })])
      })

      await act(async () => {
        await result.current.cancelCanvasAnnotations(original)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(result.current.localCanvasAnnotations).toEqual(original)
      expect(mockUpdateImage).not.toHaveBeenCalled()
    })

    it('rolls back an edit that was already autosaved', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      mockUpdateImage
        .mockResolvedValueOnce({
          ...image,
          version: 2,
          metadata_extra: { canvas_annotations: edited },
        })
        .mockResolvedValueOnce({
          ...image,
          version: 3,
          metadata_extra: { canvas_annotations: original },
        })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      await act(async () => {
        await result.current.cancelCanvasAnnotations(original)
      })

      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: original } },
        2,
      )
      expect(result.current.localCanvasAnnotations).toEqual(original)
    })

    it('awaits an in-flight rollback even when the selected image changes', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image1 = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      const image2 = makeImage({ id: 2 })
      let resolveFirst!: (value: ImageItem) => void
      const firstSave = new Promise<ImageItem>((resolve) => {
        resolveFirst = resolve
      })
      mockUpdateImage.mockReturnValueOnce(firstSave as never).mockResolvedValueOnce({
        ...image1,
        version: 3,
        metadata_extra: { canvas_annotations: original },
      })
      const deps = makeDeps({ selectedImage: image1 })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      const cancellation = result.current.cancelCanvasAnnotations(original)
      rerender({ ...deps, selectedImage: image2 })
      resolveFirst({
        ...image1,
        version: 2,
        metadata_extra: { canvas_annotations: edited },
      })
      await act(async () => {
        await cancellation
      })

      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        1,
        1,
        { metadata_extra_merge: { canvas_annotations: edited } },
        1,
      )
      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        2,
        1,
        { metadata_extra_merge: { canvas_annotations: original } },
        2,
      )
    })

    it('drops edits received while cancellation is in progress', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const later = [makeAnnotation({ id: 'later' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      let resolveFirst!: (value: ImageItem) => void
      let resolveRollback!: (value: ImageItem) => void
      const firstSave = new Promise<ImageItem>((resolve) => {
        resolveFirst = resolve
      })
      const rollbackSave = new Promise<ImageItem>((resolve) => {
        resolveRollback = resolve
      })
      mockUpdateImage
        .mockReturnValueOnce(firstSave as never)
        .mockReturnValueOnce(rollbackSave as never)
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      const cancellation = result.current.cancelCanvasAnnotations(original)
      act(() => {
        result.current.handleCanvasAnnotationsChange(later)
      })
      resolveFirst({
        ...image,
        version: 2,
        metadata_extra: { canvas_annotations: edited },
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)

      resolveRollback({
        ...image,
        version: 3,
        metadata_extra: { canvas_annotations: original },
      })
      await act(async () => {
        await cancellation
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(result.current.localCanvasAnnotations).toEqual(original)
    })

    it('rolls back a persisted edit after an unsuccessful category refresh', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      mockUpdateImage
        .mockResolvedValueOnce({
          ...image,
          version: 2,
          metadata_extra: { canvas_annotations: edited },
        })
        .mockResolvedValueOnce({
          ...image,
          version: 3,
          metadata_extra: { canvas_annotations: original },
        })
      // loadCategories reports a failed refresh by resolving false rather
      // than rejecting, matching useBrowseData's production contract.
      const loadCategories = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
      const deps = makeDeps({ selectedImage: image, loadCategories })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(loadCategories).toHaveBeenCalledOnce()

      let cancelled!: boolean
      await act(async () => {
        cancelled = await result.current.cancelCanvasAnnotations(original)
      })

      expect(cancelled).toBe(true)
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: original } },
        2,
      )
    })

    it('does not overwrite authoritative annotations when cancellation follows a conflict', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      mockUpdateImage.mockRejectedValueOnce(
        new api.ApiError(409, 'This item was modified by another user.'),
      )
      const fetchImage = vi.fn()
      const { result } = renderHook(() =>
        useCanvasAnnotations(makeDeps({ selectedImage: image, fetchImage })),
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        await Promise.resolve()
        await Promise.resolve()
      })

      let cancelled!: boolean
      await act(async () => {
        cancelled = await result.current.cancelCanvasAnnotations(original)
      })

      expect(cancelled).toBe(false)
      expect(fetchImage).not.toHaveBeenCalled()
      expect(mockUpdateImage).toHaveBeenCalledOnce()
    })

    it('reconciles a rejected save before a second cancellation attempt', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      mockUpdateImage.mockReturnValueOnce(firstSave as never).mockResolvedValueOnce({
        ...image,
        version: 3,
        metadata_extra: { canvas_annotations: original },
      })
      const fetchImage = vi.fn().mockResolvedValue({
        version: 2,
        metadata_extra: { canvas_annotations: edited },
      })
      const deps = makeDeps({ selectedImage: image, fetchImage })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      const firstCancellation = result.current.cancelCanvasAnnotations(original)
      rejectFirst(responseLostError())
      let firstCancelled!: boolean
      await act(async () => {
        firstCancelled = await firstCancellation
      })

      expect(firstCancelled).toBe(false)
      expect(fetchImage).not.toHaveBeenCalled()

      let secondCancelled!: boolean
      await act(async () => {
        secondCancelled = await result.current.cancelCanvasAnnotations(original)
      })

      expect(secondCancelled).toBe(true)
      expect(fetchImage).toHaveBeenCalledOnce()
      expect(fetchImage).toHaveBeenCalledWith(1)
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: original } },
        2,
      )
    })

    it('synchronizes a matching reconciliation before the next save', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const laterEdit = [makeAnnotation({ id: 'later' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      let rejectFirst!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectFirst = reject
      })
      const authoritativeMetadata = { canvas_annotations: original, custom: 'fresh' }
      mockUpdateImage.mockReturnValueOnce(firstSave as never).mockResolvedValueOnce({
        ...image,
        version: 6,
        metadata_extra: { canvas_annotations: laterEdit, custom: 'fresh' },
      })
      const fetchImage = vi.fn().mockResolvedValue({
        version: 5,
        metadata_extra: authoritativeMetadata,
      })
      const deps = makeDeps({ selectedImage: image, fetchImage })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      const firstCancellation = result.current.cancelCanvasAnnotations(original)
      rejectFirst(responseLostError())
      await act(async () => {
        await firstCancellation
      })

      await act(async () => {
        await result.current.cancelCanvasAnnotations(original)
      })

      expect(result.current.latestVersionRef.current).toBe(5)
      expect(result.current.latestMetadataRef.current).toEqual(authoritativeMetadata)
      expect(mockUpdateImage).toHaveBeenCalledOnce()

      act(() => {
        result.current.handleCanvasAnnotationsChange(laterEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: laterEdit } },
        5,
      )
    })

    it('reconciles uncertain saves for each image after an image switch', async () => {
      const original1 = [makeAnnotation({ id: 'original-1' })]
      const edited1 = [makeAnnotation({ id: 'edited-1' })]
      const original2 = [makeAnnotation({ id: 'original-2' })]
      const edited2 = [makeAnnotation({ id: 'edited-2' })]
      const image1 = makeImage({ id: 1, metadataExtra: { canvas_annotations: original1 } })
      const image2 = makeImage({ id: 2, metadataExtra: { canvas_annotations: original2 } })
      let rejectImage1!: (reason?: unknown) => void
      let rejectImage2!: (reason?: unknown) => void
      const firstSave = new Promise<ImageItem>((_, reject) => {
        rejectImage1 = reject
      })
      const secondSave = new Promise<ImageItem>((_, reject) => {
        rejectImage2 = reject
      })
      mockUpdateImage
        .mockReturnValueOnce(firstSave as never)
        .mockReturnValueOnce(secondSave as never)
        .mockResolvedValueOnce({
          ...image1,
          version: 3,
          metadata_extra: { canvas_annotations: original1 },
        })
        .mockResolvedValueOnce({
          ...image2,
          version: 5,
          metadata_extra: { canvas_annotations: original2 },
        })
      const fetchImage = vi
        .fn()
        .mockImplementation((imageId: number) =>
          Promise.resolve(
            imageId === image1.id
              ? { version: 2, metadata_extra: { canvas_annotations: edited1 } }
              : { version: 4, metadata_extra: { canvas_annotations: edited2 } },
          ),
        )
      const deps = makeDeps({ selectedImage: image1, fetchImage })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited1)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      rerender({ ...deps, selectedImage: image2 })
      act(() => {
        result.current.handleCanvasAnnotationsChange(edited2)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      rejectImage1(responseLostError())
      rejectImage2(responseLostError())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      rerender({ ...deps, selectedImage: image1 })
      await act(async () => {
        await result.current.cancelCanvasAnnotations(original1)
      })
      rerender({ ...deps, selectedImage: image2 })
      await act(async () => {
        await result.current.cancelCanvasAnnotations(original2)
      })

      expect(fetchImage).toHaveBeenNthCalledWith(1, 1)
      expect(fetchImage).toHaveBeenNthCalledWith(2, 2)
      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        3,
        1,
        { metadata_extra_merge: { canvas_annotations: original1 } },
        2,
      )
      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        4,
        2,
        { metadata_extra_merge: { canvas_annotations: original2 } },
        4,
      )
    })

    it('awaits the matching in-flight save when saves overlap across images', async () => {
      const original1 = [makeAnnotation({ id: 'original-1' })]
      const edited1 = [makeAnnotation({ id: 'edited-1' })]
      const edited2 = [makeAnnotation({ id: 'edited-2' })]
      const image1 = makeImage({ id: 1, metadataExtra: { canvas_annotations: original1 } })
      const image2 = makeImage({ id: 2 })
      let resolveImage1!: (value: ImageItem) => void
      let resolveImage2!: (value: ImageItem) => void
      const image1Save = new Promise<ImageItem>((resolve) => {
        resolveImage1 = resolve
      })
      const image2Save = new Promise<ImageItem>((resolve) => {
        resolveImage2 = resolve
      })
      mockUpdateImage
        .mockReturnValueOnce(image1Save as never)
        .mockReturnValueOnce(image2Save as never)
        .mockResolvedValueOnce({
          ...image1,
          version: 3,
          metadata_extra: { canvas_annotations: original1 },
        })
      const deps = makeDeps({ selectedImage: image1 })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited1)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      rerender({ ...deps, selectedImage: image2 })
      act(() => {
        result.current.handleCanvasAnnotationsChange(edited2)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      rerender({ ...deps, selectedImage: image1 })

      const cancellation = result.current.cancelCanvasAnnotations(original1)
      resolveImage1({
        ...image1,
        version: 2,
        metadata_extra: { canvas_annotations: edited1 },
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockUpdateImage).toHaveBeenCalledTimes(3)
      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: original1 } },
        2,
      )

      resolveImage2({
        ...image2,
        version: 2,
        metadata_extra: { canvas_annotations: edited2 },
      })
      await act(async () => {
        await cancellation
      })
    })

    it('serializes later edits for B while A cancellation rolls back', async () => {
      const originalA = [makeAnnotation({ id: 'original-a' })]
      const editedA = [makeAnnotation({ id: 'edited-a' })]
      const firstBEdit = [makeAnnotation({ id: 'first-b' })]
      const laterBEdit = [makeAnnotation({ id: 'later-b' })]
      const imageA = makeImage({ id: 1, metadataExtra: { canvas_annotations: originalA } })
      const imageB = makeImage({ id: 2 })
      let resolveASave!: (value: ImageItem) => void
      let resolveBSave!: (value: ImageItem) => void
      let resolveARollback!: (value: ImageItem) => void
      let resolveBLaterSave!: (value: ImageItem) => void
      const aSave = new Promise<ImageItem>((resolve) => {
        resolveASave = resolve
      })
      const bSave = new Promise<ImageItem>((resolve) => {
        resolveBSave = resolve
      })
      const aRollback = new Promise<ImageItem>((resolve) => {
        resolveARollback = resolve
      })
      const bLaterSave = new Promise<ImageItem>((resolve) => {
        resolveBLaterSave = resolve
      })
      mockUpdateImage
        .mockReturnValueOnce(aSave as never)
        .mockReturnValueOnce(bSave as never)
        .mockReturnValueOnce(aRollback as never)
        .mockReturnValueOnce(bLaterSave as never)
      const deps = makeDeps({ selectedImage: imageA })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(editedA)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      const cancellation = result.current.cancelCanvasAnnotations(originalA)

      rerender({ ...deps, selectedImage: imageB })
      act(() => {
        result.current.handleCanvasAnnotationsChange(firstBEdit)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      resolveASave({
        ...imageA,
        version: 2,
        metadata_extra: { canvas_annotations: editedA },
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        3,
        1,
        { metadata_extra_merge: { canvas_annotations: originalA } },
        2,
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(laterBEdit)
      })
      resolveBSave({
        ...imageB,
        version: 2,
        metadata_extra: { canvas_annotations: firstBEdit },
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockUpdateImage).toHaveBeenNthCalledWith(
        4,
        2,
        { metadata_extra_merge: { canvas_annotations: laterBEdit } },
        2,
      )

      resolveARollback({
        ...imageA,
        version: 3,
        metadata_extra: { canvas_annotations: originalA },
      })
      resolveBLaterSave({
        ...imageB,
        version: 3,
        metadata_extra: { canvas_annotations: laterBEdit },
      })
      await act(async () => {
        await cancellation
      })
    })

    it('allows a new image to save while an old image cancellation is pending', async () => {
      const original1 = [makeAnnotation({ id: 'original-1' })]
      const edited1 = [makeAnnotation({ id: 'edited-1' })]
      const edited2 = [makeAnnotation({ id: 'edited-2' })]
      const image1 = makeImage({ id: 1, metadataExtra: { canvas_annotations: original1 } })
      const image2 = makeImage({ id: 2 })
      let resolveRollback!: (value: ImageItem) => void
      const rollback = new Promise<ImageItem>((resolve) => {
        resolveRollback = resolve
      })
      mockUpdateImage
        .mockResolvedValueOnce({
          ...image1,
          version: 2,
          metadata_extra: { canvas_annotations: edited1 },
        })
        .mockReturnValueOnce(rollback as never)
        .mockResolvedValueOnce({
          ...image2,
          version: 2,
          metadata_extra: { canvas_annotations: edited2 },
        })
      const deps = makeDeps({ selectedImage: image1 })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited1)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      const cancellation = result.current.cancelCanvasAnnotations(original1)
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
      rerender({ ...deps, selectedImage: image2 })
      act(() => {
        result.current.handleCanvasAnnotationsChange(edited2)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenLastCalledWith(
        2,
        { metadata_extra_merge: { canvas_annotations: edited2 } },
        1,
      )

      resolveRollback({
        ...image1,
        version: 3,
        metadata_extra: { canvas_annotations: original1 },
      })
      await act(async () => {
        await cancellation
      })
    })

    it('returns failure when an autosaved edit cannot be rolled back', async () => {
      const original = [makeAnnotation({ id: 'original' })]
      const edited = [makeAnnotation({ id: 'edited' })]
      const image = makeImage({ id: 1, metadataExtra: { canvas_annotations: original } })
      mockUpdateImage
        .mockResolvedValueOnce({
          ...image,
          version: 2,
          metadata_extra: { canvas_annotations: edited },
        })
        .mockRejectedValueOnce(new Error('Rollback failed'))
      const setErrorSnack = vi.fn()
      const deps = makeDeps({ selectedImage: image, setErrorSnack })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange(edited)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      let cancelled!: boolean
      await act(async () => {
        cancelled = await result.current.cancelCanvasAnnotations(original)
      })

      expect(cancelled).toBe(false)
      expect(setErrorSnack).toHaveBeenCalled()
      expect(mockUpdateImage).toHaveBeenCalledTimes(2)
    })
  })

  describe('image change reset', () => {
    it('clears local annotations when selectedImage changes', () => {
      const image1 = makeImage({ id: 1, metadataExtra: { canvas_annotations: [makeAnnotation()] } })
      const deps = makeDeps({ selectedImage: image1 })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      // Set local annotations
      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation({ vpX: 0.05 })])
      })
      expect(result.current.localCanvasAnnotations).not.toBeNull()

      // Change image
      const image2 = makeImage({ id: 2 })
      rerender({ ...deps, selectedImage: image2 })

      expect(result.current.localCanvasAnnotations).toBeNull()
    })
  })

  describe('version tracking', () => {
    it('exposes latestVersionRef that updates after saves', async () => {
      const image = makeImage({ id: 1, version: 5 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 6,
        metadata_extra: { canvas_annotations: [makeAnnotation()] },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      expect(result.current.latestVersionRef.current).toBe(5)

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(result.current.latestVersionRef.current).toBe(6)
    })

    it('exposes latestMetadataRef that updates after saves', async () => {
      const image = makeImage({ id: 1 })
      const newMeta = { canvas_annotations: [makeAnnotation()], custom: 'data' }
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: newMeta,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(result.current.latestMetadataRef.current).toEqual(newMeta)
    })

    it('resets version ref when image changes', () => {
      const image1 = makeImage({ id: 1, version: 5 })
      const deps = makeDeps({ selectedImage: image1 })
      const { result, rerender } = renderHook(
        (props: UseCanvasAnnotationsDeps) => useCanvasAnnotations(props),
        { initialProps: deps },
      )

      expect(result.current.latestVersionRef.current).toBe(5)

      const image2 = makeImage({ id: 2, version: 10 })
      rerender({ ...deps, selectedImage: image2 })

      expect(result.current.latestVersionRef.current).toBe(10)
    })
  })

  describe('error handling', () => {
    it('calls setErrorSnack on save failure', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockRejectedValue(new Error('Network error'))
      const setErrorSnack = vi.fn()
      const deps = makeDeps({ selectedImage: image, setErrorSnack })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(setErrorSnack).toHaveBeenCalled()
    })
  })

  describe('save sends null for empty annotations', () => {
    it('sends null when annotations array is empty', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const deps = makeDeps({ selectedImage: image })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange([])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockUpdateImage).toHaveBeenCalledWith(
        1,
        { metadata_extra_merge: { canvas_annotations: null } },
        1,
      )
    })
  })

  describe('category refresh after save', () => {
    it('calls loadCategories and loadUncategorizedImages after save', async () => {
      const image = makeImage({ id: 1 })
      mockUpdateImage.mockResolvedValue({
        id: 1,
        name: 'img-1',
        thumb: '/t',
        tile_sources: '/s',
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        version: 2,
        metadata_extra: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        width: null,
        height: null,
        file_size: null,
      })
      const loadCategories = vi.fn().mockResolvedValue(undefined)
      const loadUncategorizedImages = vi.fn()
      const deps = makeDeps({ selectedImage: image, loadCategories, loadUncategorizedImages })
      const { result } = renderHook(() => useCanvasAnnotations(deps))

      act(() => {
        result.current.handleCanvasAnnotationsChange([makeAnnotation()])
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(loadCategories).toHaveBeenCalled()
      expect(loadUncategorizedImages).toHaveBeenCalled()
    })
  })
})
