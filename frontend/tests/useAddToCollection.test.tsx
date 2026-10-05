import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  addImagesToCollection,
  createCollectionWithImages,
  fitsCollectionCapacity,
  removeImagesFromCollection,
  useEditableCollections,
  useVisibleCollections,
} from '../src/useAddToCollection'
import { ApiError } from '../src/api'
import { makeApiCollection, makeApiCollectionSummary } from './helpers/fixtures'

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

  it('never caps sequence collections', () => {
    expect(fitsCollectionCapacity({ type: 'sequence' }, 400, [1, 2, 3])).toBe(true)
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

  it('propagates API errors from the replace call', async () => {
    apiMocks.fetchCollection.mockResolvedValue(makeApiCollection({ id: 5, type: 'sequence' }))
    apiMocks.replaceCollectionImages.mockRejectedValue(new ApiError(409, 'stale'))
    await expect(addImagesToCollection(5, [9])).rejects.toBeInstanceOf(ApiError)
  })
})

describe('removeImagesFromCollection (#1530)', () => {
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
})

describe('createCollectionWithImages', () => {
  it('posts the form values with the images preset and only sends scope when restricted', async () => {
    apiMocks.createCollection.mockResolvedValue(makeApiCollection({ id: 8, name: 'New' }))
    const created = await createCollectionWithImages(
      {
        name: 'New',
        description: null,
        type: 'sequence',
        visibility: 'private',
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
