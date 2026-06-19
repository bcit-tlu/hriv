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
