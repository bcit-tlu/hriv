import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasAnnotations } from '../src/useCanvasAnnotations'
import type { UseCanvasAnnotationsDeps } from '../src/useCanvasAnnotations'
import type { CanvasAnnotation } from '../src/components/CanvasOverlay'
import * as api from '../src/api'
import { makeImage } from './helpers/fixtures'

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../src/api')
  return { ...actual, updateImage: vi.fn() }
})

const mockUpdateImage = vi.mocked(api.updateImage)

function makeDeps(overrides: Partial<UseCanvasAnnotationsDeps> = {}): UseCanvasAnnotationsDeps {
  return {
    selectedImage: makeImage({ id: 1 }),
    loadCategories: vi.fn().mockResolvedValue(undefined),
    loadUncategorizedImages: vi.fn(),
    setErrorSnack: vi.fn(),
    ...overrides,
  }
}

const annotation: CanvasAnnotation = {
  id: 'a',
  type: 'text',
  vpX: 0.1,
  vpY: 0.2,
  vpWidth: 0.3,
  vpHeight: 0.1,
  color: '#000000',
  text: 'Draft',
}

function updatedImage(version = 2, metadata_extra: Record<string, unknown> | null = null) {
  return {
    id: 1,
    name: 'Test Image',
    thumb: '/thumb',
    tile_sources: '/tiles',
    category_id: null,
    copyright: null,
    note: null,
    active: true,
    sort_order: 0,
    version,
    metadata_extra,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    width: null,
    height: null,
    file_size: null,
  } as Awaited<ReturnType<typeof api.updateImage>>
}

describe('useCanvasAnnotations', () => {
  beforeEach(() => mockUpdateImage.mockReset())

  it('updates a local draft without autosaving', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useCanvasAnnotations(deps))

    act(() => result.current.handleCanvasAnnotationsChange([annotation]))

    expect(result.current.localCanvasAnnotations).toEqual([annotation])
    expect(result.current.canvasDraftDirty).toBe(true)
    expect(mockUpdateImage).not.toHaveBeenCalled()
  })

  it('saves one exact snapshot and clears dirty state only after success', async () => {
    mockUpdateImage.mockResolvedValue(
      updatedImage(4, { canvas_annotations: [annotation], other: 'preserved' }),
    )
    const deps = makeDeps()
    const { result } = renderHook(() => useCanvasAnnotations(deps))

    act(() => result.current.handleCanvasAnnotationsChange([annotation]))
    let saved = false
    await act(async () => {
      saved = await result.current.saveCanvasAnnotations([annotation])
    })

    expect(saved).toBe(true)
    expect(mockUpdateImage).toHaveBeenCalledWith(1, {
      metadata_extra_merge: { canvas_annotations: [annotation] },
    })
    expect(result.current.canvasDraftDirty).toBe(false)
    expect(result.current.latestVersionRef.current).toBe(4)
  })

  it('keeps a failed draft editable and allows retry', async () => {
    const setErrorSnack = vi.fn()
    const deps = makeDeps({ setErrorSnack })
    const { result } = renderHook(() => useCanvasAnnotations(deps))
    mockUpdateImage
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(updatedImage())

    act(() => result.current.handleCanvasAnnotationsChange([annotation]))
    await act(async () => {
      expect(await result.current.saveCanvasAnnotations([annotation])).toBe(false)
    })
    expect(result.current.canvasDraftDirty).toBe(true)
    expect(result.current.localCanvasAnnotations).toEqual([annotation])
    expect(setErrorSnack).toHaveBeenCalled()

    await act(async () => {
      expect(await result.current.saveCanvasAnnotations([annotation])).toBe(true)
    })
    expect(result.current.canvasDraftDirty).toBe(false)
  })

  it('discards locally without issuing a request', () => {
    const original = [annotation]
    const deps = makeDeps({
      selectedImage: makeImage({ id: 1, metadataExtra: { canvas_annotations: original } }),
    })
    const { result } = renderHook(() => useCanvasAnnotations(deps))
    const draft = [{ ...annotation, text: 'Changed' }]

    act(() => result.current.handleCanvasAnnotationsChange(draft))
    act(() => result.current.discardCanvasAnnotations())

    expect(result.current.canvasDraftDirty).toBe(false)
    expect(result.current.localCanvasAnnotations).toEqual(original)
    expect(mockUpdateImage).not.toHaveBeenCalled()
  })
})
