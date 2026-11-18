import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  addImagesToCollection,
  addSourcesToCollection,
  createCollectionFromSources,
  createCollectionWithImages,
  fitsCollectionCapacity,
  removeImagesFromCollection,
  useEditableCollections,
  useVisibleCollections,
} from '../src/useAddToCollection'
import { ApiError } from '../src/api'
import {
  makeApiCollection,
  makeApiCollectionSummary,
  makeCollection,
  makeImage,
} from './helpers/fixtures'

const apiMocks = vi.hoisted(() => ({
  fetchCollections: vi.fn(),
  fetchCollection: vi.fn(),
  replaceCollectionImages: vi.fn(),
  createCollection: vi.fn(),
}))

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  ...apiMocks,
}))

function apiImage(id: number) {
  return {
    id,
    name: `Image ${id}`,
    thumb: `/thumbs/${id}.jpg`,
    tile_sources: `/tiles/${id}.dzi`,
    category_id: 1,
    copyright: null,
    note: null,
    active: true,
    sort_order: id,
    version: 1,
    created_at: null,
    updated_at: null,
    metadata_extra: null,
    width: null,
    height: null,
    file_size: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fitsCollectionCapacity', () => {
  it('caps synchronized collections at four images in total', () => {
    expect(fitsCollectionCapacity({ type: 'synchronized' }, 3, [1])).toBe(true)
    expect(fitsCollectionCapacity({ type: 'synchronized' }, 4, [1])).toBe(false)
    expect(fitsCollectionCapacity({ type: 'synchronized' }, 2, [1, 2, 3])).toBe(false)
  })

  it('caps sequence collections only for students', () => {
    expect(fitsCollectionCapacity({ type: 'sequence' }, 400, [1, 2, 3])).toBe(true)
    expect(fitsCollectionCapacity({ type: 'sequence' }, 19, [1], 'student')).toBe(true)
    expect(fitsCollectionCapacity({ type: 'sequence' }, 20, [1], 'student')).toBe(false)
    expect(fitsCollectionCapacity({ type: 'sequence' }, 400, [1, 2, 3], 'instructor')).toBe(true)
  })
})

describe('addImagesToCollection', () => {
  it('appends missing ids to the current member list with the current version', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        version: 3,
        images: [apiImage(1), apiImage(2)],
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        version: 4,
        images: [apiImage(1), apiImage(2), apiImage(9)],
      }),
    )
    const result = await addImagesToCollection(5, [2, 9, 9])
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: [1, 2, 9],
      version: 3,
    })
    expect(result.status).toBe('added')
    if (result.status === 'added') {
      expect(result.addedCount).toBe(1)
      expect(result.collection.version).toBe(4)
      expect(result.collection.images.map((i) => i.id)).toEqual([1, 2, 9])
    }
  })

  it('is a no-op when every image is already present', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({ id: 5, images: [apiImage(1), apiImage(2)] }),
    )
    const result = await addImagesToCollection(5, [1])
    expect(result.status).toBe('already')
    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
  })

  it('refuses to overfill a synchronized collection without calling the API', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'synchronized',
        images: [apiImage(1), apiImage(2), apiImage(3), apiImage(4)],
      }),
    )
    const result = await addImagesToCollection(5, [9])
    expect(result.status).toBe('full')
    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
  })

  it('refuses a student sequence addition above twenty images without calling the API', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        images: Array.from({ length: 20 }, (_, i) => apiImage(i + 1)),
      }),
    )
    const result = await addImagesToCollection(5, [21], 'student')
    expect(result.status).toBe('full')
    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
  })

  it('reserves a hidden member slot for a student sequence addition', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        member_count: 20,
        images: Array.from({ length: 19 }, (_, i) => apiImage(i + 1)),
      }),
    )

    const result = await addImagesToCollection(5, [20], 'student')

    expect(result.status).toBe('full')
    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
  })

  it('allows a student sequence addition when nine visible members fill nine slots', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        member_count: 19,
        images: Array.from({ length: 19 }, (_, i) => apiImage(i + 1)),
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        member_count: 20,
        images: Array.from({ length: 20 }, (_, i) => apiImage(i + 1)),
      }),
    )

    const result = await addImagesToCollection(5, [20], 'student')

    expect(result.status).toBe('added')
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: Array.from({ length: 20 }, (_, i) => i + 1),
      version: 1,
    })
  })

  it('allows a non-student to add more than twenty sequence images', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        version: 3,
        images: Array.from({ length: 20 }, (_, i) => apiImage(i + 1)),
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'sequence',
        version: 4,
        images: Array.from({ length: 21 }, (_, i) => apiImage(i + 1)),
      }),
    )
    const result = await addImagesToCollection(5, [21], 'instructor')
    expect(result.status).toBe('added')
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: Array.from({ length: 21 }, (_, i) => i + 1),
      version: 3,
    })
  })

  it('propagates API errors from the replace call', async () => {
    apiMocks.fetchCollection.mockResolvedValue(makeApiCollection({ id: 5, type: 'sequence' }))
    apiMocks.replaceCollectionImages.mockRejectedValue(new ApiError(409, 'stale'))
    await expect(addImagesToCollection(5, [9])).rejects.toBeInstanceOf(ApiError)
  })
})

describe('removeImagesFromCollection (#1530)', () => {
  it('keeps the remaining slot when a synchronized collection is reduced to one image', async () => {
    const slot = { id: 21, viewport_state: null, thumb: null, label: null }
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'synchronized',
        version: 4,
        images: [
          { ...apiImage(1), slot },
          { ...apiImage(2), slot: { ...slot, id: 22 } },
        ],
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({
        id: 5,
        type: 'synchronized',
        version: 5,
        images: [{ ...apiImage(1), slot }],
      }),
    )
    const result = await removeImagesFromCollection(5, [2], undefined, true)
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      slots: [{ id: 21, image_id: 1 }],
      version: 4,
    })
    expect(result.images.map((image) => image.slot?.id)).toEqual([21])
  })

  it('PUTs the member list minus the removed ids with the current version', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        version: 4,
        images: [apiImage(1), apiImage(2), apiImage(9)],
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({ id: 5, version: 5, images: [apiImage(1), apiImage(2)] }),
    )

    const result = await removeImagesFromCollection(5, [9])

    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: [1, 2],
      version: 4,
    })
    expect(result.images.map((i) => i.id)).toEqual([1, 2])
  })

  it('skips the PUT when none of the ids are members', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({ id: 5, version: 4, images: [apiImage(1), apiImage(2)] }),
    )

    const result = await removeImagesFromCollection(5, [9, 10])

    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
    expect(result.images.map((i) => i.id)).toEqual([1, 2])
  })

  it('removes only listed ids, keeping other members', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        id: 5,
        version: 2,
        images: [apiImage(1), apiImage(2), apiImage(3)],
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({ id: 5, version: 3, images: [apiImage(1), apiImage(3)] }),
    )

    await removeImagesFromCollection(5, [2])

    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: [1, 3],
      version: 2,
    })
  })

  it('pins the undo base record — skips the fetch and PUTs at its version', async () => {
    // `base` is the record returned by the add being undone: the PUT must
    // carry its version so another editor's intervening write 409s rather
    // than being silently overwritten (undo convention).
    const base = makeCollection({
      id: 5,
      version: 6,
      images: [makeImage({ id: 1 }), makeImage({ id: 42 })],
    })
    apiMocks.replaceCollectionImages.mockResolvedValue(
      makeApiCollection({ id: 5, version: 7, images: [apiImage(1)] }),
    )

    const result = await removeImagesFromCollection(5, [42], base)

    expect(apiMocks.fetchCollection).not.toHaveBeenCalled()
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      image_ids: [1],
      version: 6,
    })
    expect(result.images.map((i) => i.id)).toEqual([1])
  })

  it('with a base record, an intervening change surfaces as a 409 conflict', async () => {
    const base = makeCollection({ id: 5, version: 6, images: [makeImage({ id: 42 })] })
    apiMocks.replaceCollectionImages.mockRejectedValue(new ApiError(409, 'Collection was modified'))

    await expect(removeImagesFromCollection(5, [42], base)).rejects.toMatchObject({ status: 409 })
    expect(apiMocks.fetchCollection).not.toHaveBeenCalled()
  })
})

describe('createCollectionWithImages', () => {
  it('creates a synchronized collection from one whole-image slot with the feature enabled', async () => {
    apiMocks.createCollection.mockResolvedValue(
      makeApiCollection({ id: 8, type: 'synchronized', images: [apiImage(42)] }),
    )
    const result = await createCollectionWithImages(
      {
        name: 'Start comparison',
        description: null,
        type: 'synchronized',
        visibility: 'private',
        programIds: [],
        groupIds: [],
      },
      [42],
      true,
    )
    expect(apiMocks.createCollection).toHaveBeenCalledWith({
      name: 'Start comparison',
      description: null,
      type: 'synchronized',
      visibility: 'private',
      slots: [{ image_id: 42 }],
    })
    expect(result.images.map((image) => image.id)).toEqual([42])
  })

  it('posts the form values with the images preset and only sends scope when restricted', async () => {
    apiMocks.createCollection.mockResolvedValue(makeApiCollection({ id: 8, name: 'New' }))
    const created = await createCollectionWithImages(
      {
        name: 'New',
        description: null,
        type: 'sequence',
        visibility: 'private',
        categoryId: 10,
        programIds: [],
        groupIds: [],
      },
      [42, 42, 7],
    )
    expect(apiMocks.createCollection).toHaveBeenCalledWith({
      name: 'New',
      description: null,
      type: 'sequence',
      visibility: 'private',
      category_id: 10,
      image_ids: [42, 7],
    })
    expect(created.id).toBe(8)

    await createCollectionWithImages(
      {
        name: 'Scoped',
        description: 'd',
        type: 'synchronized',
        visibility: 'restricted',
        programIds: [1],
        groupIds: [10],
      },
      [42],
    )
    expect(apiMocks.createCollection).toHaveBeenLastCalledWith({
      name: 'Scoped',
      description: 'd',
      type: 'synchronized',
      visibility: 'restricted',
      image_ids: [42],
      program_ids: [1],
      group_ids: [10],
    })
  })
})

describe('useVisibleCollections', () => {
  it('loads on open and keeps every row — visibility is already enforced server-side', async () => {
    apiMocks.fetchCollections.mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Editable' }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Read only',
        permissions: { can_edit: false, can_delete: false, can_transfer: false },
      }),
    ])
    const { result, rerender } = renderHook(({ enabled }) => useVisibleCollections(enabled), {
      initialProps: { enabled: false },
    })
    expect(apiMocks.fetchCollections).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.collections.map((c) => c.name)).toEqual(['Editable', 'Read only'])
  })

  it('clears the list when a refresh fails so stale rows are not served', async () => {
    apiMocks.fetchCollections.mockResolvedValueOnce([
      makeApiCollectionSummary({ id: 1, name: 'Editable' }),
    ])
    const { result } = renderHook(() => useVisibleCollections(true))
    await waitFor(() => expect(result.current.collections).toHaveLength(1))

    apiMocks.fetchCollections.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.collections).toEqual([])
    expect(result.current.error).toBe('Failed to load collections.')
  })
})

describe('useEditableCollections', () => {
  it('loads on open, keeps only can_edit rows and reloads on the next open', async () => {
    apiMocks.fetchCollections.mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Editable' }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Read only',
        permissions: { can_edit: false, can_delete: false, can_transfer: false },
      }),
    ])
    const { result, rerender } = renderHook(({ enabled }) => useEditableCollections(enabled), {
      initialProps: { enabled: false },
    })
    expect(apiMocks.fetchCollections).not.toHaveBeenCalled()

    rerender({ enabled: true })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(apiMocks.fetchCollections).toHaveBeenCalledTimes(1)
    expect(result.current.collections.map((c) => c.name)).toEqual(['Editable'])

    rerender({ enabled: false })
    rerender({ enabled: true })
    await waitFor(() => expect(apiMocks.fetchCollections).toHaveBeenCalledTimes(2))
  })

  it('surfaces a load failure and clears it on reload', async () => {
    apiMocks.fetchCollections.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { result } = renderHook(() => useEditableCollections(true))
    await waitFor(() => expect(result.current.error).toBe('Failed to load collections.'))
    apiMocks.fetchCollections.mockResolvedValueOnce([makeApiCollectionSummary({ id: 1 })])
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.collections).toHaveLength(1)
  })
})

describe('saved-view collection sources', () => {
  const slot = (id: number) => ({
    id,
    viewport_state: { x: id / 10, y: 0.5, zoom: 2 },
    thumb: '/snapshot.jpg',
    label: 'Study ' + id,
  })
  it('creates a Board sequence without deduplicating same-image slots in its response', async () => {
    apiMocks.createCollection.mockResolvedValue(
      makeApiCollection({ images: [1, 2, 3].map((id) => ({ ...apiImage(9), slot: slot(id) })) }),
    )
    const result = await createCollectionFromSources(
      {
        name: 'Board sequence',
        description: null,
        type: 'sequence',
        visibility: 'private',
        categoryId: null,
        programIds: [],
        groupIds: [],
        hidden: false,
      },
      { source_board_id: 7 },
    )
    expect(apiMocks.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ source_board_id: 7 }),
    )
    expect(result.images.map((image) => image.id)).toEqual([9, 9, 9])
    expect(result.images.map((image) => image.slot?.id)).toEqual([1, 2, 3])
  })
  it('appends selected Markers while preserving every existing slot id', async () => {
    apiMocks.fetchCollection.mockResolvedValue(
      makeApiCollection({
        version: 4,
        images: [1, 2].map((id) => ({ ...apiImage(9), slot: slot(id) })),
      }),
    )
    apiMocks.replaceCollectionImages.mockResolvedValue(makeApiCollection())
    await addSourcesToCollection(5, { marker_ids: [31, 32] })
    expect(apiMocks.replaceCollectionImages).toHaveBeenCalledWith(5, {
      version: 4,
      slots: [
        { id: 1, image_id: 9 },
        { id: 2, image_id: 9 },
      ],
      marker_ids: [31, 32],
    })
  })
  it('keeps source failures visible to the caller', async () => {
    apiMocks.fetchCollection.mockRejectedValue(new Error('Access lost'))
    await expect(addSourcesToCollection(5, { source_board_id: 7 })).rejects.toThrow('Access lost')
    expect(apiMocks.replaceCollectionImages).not.toHaveBeenCalled()
  })
})
