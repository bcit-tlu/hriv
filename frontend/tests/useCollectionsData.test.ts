import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../src/api'
import type { User } from '../src/types'
import {
  DEFAULT_COLLECTION_FILTERS,
  COLLECTION_NOT_FOUND_MESSAGE,
  matchesCollectionFilters,
  toCollectionApiFilters,
  toCollectionPatch,
  useCollectionsData,
} from '../src/useCollectionsData'
import type { CollectionFormValues } from '../src/components/CollectionEditDialog'
import { makeApiCollection, makeApiCollectionSummary, makeCollection } from './helpers/fixtures'

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>()
  return {
    ...actual,
    fetchCollections: vi.fn(),
    fetchCollection: vi.fn(),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
  }
})

import {
  createCollection,
  deleteCollection,
  fetchCollection,
  fetchCollections,
  updateCollection,
} from '../src/api'

const fetchCollectionsMock = vi.mocked(fetchCollections)
const fetchCollectionMock = vi.mocked(fetchCollection)
const createCollectionMock = vi.mocked(createCollection)
const updateCollectionMock = vi.mocked(updateCollection)
const deleteCollectionMock = vi.mocked(deleteCollection)

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'instructor',
    active: true,
    program_ids: [],
    program_names: [],
    group_ids: [],
    group_names: [],
    ...overrides,
  } as User
}

const VALUES: CollectionFormValues = {
  name: 'Skulls',
  description: 'Frontal vs lateral',
  type: 'sequence',
  visibility: 'private',
  programIds: [],
  groupIds: [],
}

function renderData(
  options: Partial<Parameters<typeof useCollectionsData>[0]> = {},
  user: User | null = makeUser(),
) {
  return renderHook(
    (props: Partial<Parameters<typeof useCollectionsData>[0]>) =>
      useCollectionsData({
        enabled: true,
        currentUser: user,
        selectedCollectionId: null,
        ...options,
        ...props,
      }),
    { initialProps: {} },
  )
}

describe('toCollectionApiFilters', () => {
  it('sends nothing for the defaults', () => {
    expect(toCollectionApiFilters(DEFAULT_COLLECTION_FILTERS, { role: 'admin' })).toEqual({})
  })

  it('maps type, mine and owner filters', () => {
    expect(
      toCollectionApiFilters({ type: 'sequence', mine: true, owner: 'any' }, { role: 'student' }),
    ).toEqual({ type: 'sequence', mine: true })
    expect(
      toCollectionApiFilters(
        { type: 'all', mine: false, owner: { kind: 'user', userId: 3, name: 'X' } },
        { role: 'instructor' },
      ),
    ).toEqual({ owner_user_id: 3 })
    expect(
      toCollectionApiFilters(
        { type: 'all', mine: false, owner: { kind: 'program', programId: 4, name: 'P' } },
        { role: 'staff' },
      ),
    ).toEqual({ owner_program_id: 4 })
  })

  it('never sends owner_* or orphaned for students', () => {
    const owners = [
      { kind: 'user', userId: 3, name: 'X' },
      { kind: 'program', programId: 4, name: 'P' },
      'orphaned',
    ] as const
    for (const owner of owners) {
      const api = toCollectionApiFilters(
        { type: 'sequence', mine: false, owner },
        { role: 'student' },
      )
      expect(api).toEqual({ type: 'sequence' })
      expect(api).not.toHaveProperty('owner_user_id')
      expect(api).not.toHaveProperty('owner_program_id')
      expect(api).not.toHaveProperty('orphaned')
    }
  })

  it('only sends orphaned for admins', () => {
    const filters = { type: 'all', mine: false, owner: 'orphaned' } as const
    expect(toCollectionApiFilters(filters, { role: 'admin' })).toEqual({ orphaned: true })
    expect(toCollectionApiFilters(filters, { role: 'instructor' })).toEqual({})
    expect(toCollectionApiFilters(filters, null)).toEqual({})
  })

  it('lets mine win over an owner filter', () => {
    expect(
      toCollectionApiFilters(
        { type: 'all', mine: true, owner: { kind: 'user', userId: 3, name: 'X' } },
        { role: 'admin' },
      ),
    ).toEqual({ mine: true })
  })
})

describe('matchesCollectionFilters', () => {
  const mine = makeCollection({ owner: { kind: 'user', userId: 7, name: 'Ada' } })
  const theirs = makeCollection({ owner: { kind: 'user', userId: 8, name: 'Bob' } })
  const program = makeCollection({ owner: { kind: 'program', programId: 2, name: 'P' } })
  const orphan = makeCollection({ owner: null })
  const user = makeUser()

  it('accepts everything for the defaults', () => {
    expect(matchesCollectionFilters(theirs, DEFAULT_COLLECTION_FILTERS, user)).toBe(true)
  })

  it('applies the type filter', () => {
    expect(
      matchesCollectionFilters(mine, { ...DEFAULT_COLLECTION_FILTERS, type: 'sequence' }, user),
    ).toBe(false)
    expect(
      matchesCollectionFilters(mine, { ...DEFAULT_COLLECTION_FILTERS, type: 'synchronized' }, user),
    ).toBe(true)
  })

  it('applies mine, orphaned and owner filters', () => {
    const mineOnly = { ...DEFAULT_COLLECTION_FILTERS, mine: true }
    expect(matchesCollectionFilters(mine, mineOnly, user)).toBe(true)
    expect(matchesCollectionFilters(theirs, mineOnly, user)).toBe(false)
    const orphaned = { ...DEFAULT_COLLECTION_FILTERS, owner: 'orphaned' as const }
    expect(matchesCollectionFilters(orphan, orphaned, user)).toBe(true)
    expect(matchesCollectionFilters(mine, orphaned, user)).toBe(false)
    const byUser = { ...DEFAULT_COLLECTION_FILTERS, owner: theirs.owner! }
    expect(matchesCollectionFilters(theirs, byUser, user)).toBe(true)
    expect(matchesCollectionFilters(mine, byUser, user)).toBe(false)
    const byProgram = { ...DEFAULT_COLLECTION_FILTERS, owner: program.owner! }
    expect(matchesCollectionFilters(program, byProgram, user)).toBe(true)
    expect(matchesCollectionFilters(orphan, byProgram, user)).toBe(false)
  })
})

describe('toCollectionPatch', () => {
  it('sends the full form when there is no baseline', () => {
    expect(toCollectionPatch({ ...VALUES, visibility: 'public' }, null, 3)).toEqual({
      name: 'Skulls',
      description: 'Frontal vs lateral',
      visibility: 'public',
      version: 3,
    })
    expect(
      toCollectionPatch({ ...VALUES, visibility: 'restricted', programIds: [1] }, null, 3),
    ).toMatchObject({ visibility: 'restricted', program_ids: [1], group_ids: [] })
  })

  it('omits visibility and scope for a metadata-only edit of a restricted collection', () => {
    const baseline = makeCollection({
      name: 'Old',
      description: 'Frontal vs lateral',
      visibility: 'restricted',
      programIds: [1],
      groupIds: [10],
      version: 2,
    })
    const patch = toCollectionPatch(
      { ...VALUES, visibility: 'restricted', programIds: [1], groupIds: [10] },
      baseline,
      2,
    )
    expect(patch).toEqual({ name: 'Skulls', version: 2 })
  })

  it('sends scope when it changes, even if visibility stays restricted', () => {
    const baseline = makeCollection({
      name: 'Skulls',
      description: 'Frontal vs lateral',
      visibility: 'restricted',
      programIds: [1, 2],
      groupIds: [],
    })
    expect(
      toCollectionPatch(
        { ...VALUES, visibility: 'restricted', programIds: [2, 1], groupIds: [] },
        baseline,
        1,
      ),
    ).toEqual({ version: 1 })
    expect(
      toCollectionPatch(
        { ...VALUES, visibility: 'restricted', programIds: [1], groupIds: [] },
        baseline,
        1,
      ),
    ).toEqual({ program_ids: [1], group_ids: [], version: 1 })
  })

  it('sends visibility plus scope when switching to restricted, and only visibility when leaving', () => {
    const publicBaseline = makeCollection({
      name: 'Skulls',
      description: 'Frontal vs lateral',
      visibility: 'public',
    })
    expect(
      toCollectionPatch(
        { ...VALUES, visibility: 'restricted', programIds: [1], groupIds: [] },
        publicBaseline,
        1,
      ),
    ).toEqual({ visibility: 'restricted', program_ids: [1], group_ids: [], version: 1 })
    const restrictedBaseline = makeCollection({
      name: 'Skulls',
      description: 'Frontal vs lateral',
      visibility: 'restricted',
      programIds: [1],
    })
    expect(
      toCollectionPatch(
        { ...VALUES, visibility: 'public', description: null },
        restrictedBaseline,
        5,
      ),
    ).toEqual({ description: null, visibility: 'public', version: 5 })
  })
})

describe('useCollectionsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchCollectionsMock.mockResolvedValue([])
  })

  it('does not fetch while disabled or logged out', () => {
    renderData({ enabled: false })
    renderData({}, null)
    expect(fetchCollectionsMock).not.toHaveBeenCalled()
  })

  it('loads and maps the list, deriving owner options', async () => {
    fetchCollectionsMock.mockResolvedValue([
      makeApiCollectionSummary({ id: 1, owner: { user_id: 7, name: 'Zed' } }),
      makeApiCollectionSummary({ id: 2, owner: { program_id: 3, name: 'Anatomy' } }),
      makeApiCollectionSummary({ id: 3, owner: { user_id: 7, name: 'Zed' } }),
      makeApiCollectionSummary({ id: 4, owner: null }),
    ])
    const { result } = renderData()
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.collections.map((c) => c.id)).toEqual([1, 2, 3, 4])
    expect(result.current.collections[0].owner).toEqual({ kind: 'user', userId: 7, name: 'Zed' })
    expect(result.current.ownerOptions).toEqual([
      { kind: 'program', programId: 3, name: 'Anatomy' },
      { kind: 'user', userId: 7, name: 'Zed' },
    ])
    expect(fetchCollectionsMock).toHaveBeenCalledWith({})
  })

  it('refetches with role-aware API filters when filters change', async () => {
    const { result } = renderData({}, makeUser({ role: 'student' }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))
    act(() => result.current.setFilters({ type: 'sequence', mine: false, owner: 'orphaned' }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({ type: 'sequence' })
  })

  it('keeps owner options from the unfiltered result while an owner filter is active', async () => {
    fetchCollectionsMock.mockResolvedValueOnce([
      makeApiCollectionSummary({ id: 1, owner: { user_id: 7, name: 'Ada' } }),
      makeApiCollectionSummary({ id: 2, owner: { user_id: 8, name: 'Bob' } }),
    ])
    const { result } = renderData()
    await waitFor(() => expect(result.current.ownerOptions).toHaveLength(2))
    fetchCollectionsMock.mockResolvedValueOnce([
      makeApiCollectionSummary({ id: 2, owner: { user_id: 8, name: 'Bob' } }),
    ])
    act(() =>
      result.current.setFilters({
        ...DEFAULT_COLLECTION_FILTERS,
        owner: { kind: 'user', userId: 8, name: 'Bob' },
      }),
    )
    await waitFor(() => expect(result.current.collections).toHaveLength(1))
    expect(result.current.ownerOptions).toHaveLength(2)
  })

  it('surfaces list errors and clears them on retry', async () => {
    fetchCollectionsMock.mockRejectedValueOnce(new ApiError(403, 'Not allowed'))
    const { result } = renderData()
    await waitFor(() => expect(result.current.error).toBe('Not allowed'))
    fetchCollectionsMock.mockResolvedValueOnce([makeApiCollectionSummary()])
    await act(() => result.current.reload())
    expect(result.current.error).toBeNull()
    expect(result.current.collections).toHaveLength(1)
  })

  it('ignores stale list responses that resolve after a newer request', async () => {
    let resolveFirst: (rows: ReturnType<typeof makeApiCollectionSummary>[]) => void = () => {}
    fetchCollectionsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    fetchCollectionsMock.mockResolvedValueOnce([makeApiCollectionSummary({ id: 2 })])
    const { result } = renderData()
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, type: 'sequence' }))
    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual([2]))
    act(() => resolveFirst([makeApiCollectionSummary({ id: 1 })]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.collections.map((c) => c.id)).toEqual([2])
  })

  describe('detail', () => {
    it('loads the selected collection and clears the previous one while the next loads', async () => {
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1, name: 'First' }))
      const { result, rerender } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.name).toBe('First'))
      expect(result.current.detailLoading).toBe(false)

      let resolveSecond: (api: ReturnType<typeof makeApiCollection>) => void = () => {}
      fetchCollectionMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
      rerender({ selectedCollectionId: 2 })
      expect(result.current.detailLoading).toBe(true)
      expect(result.current.detail).toBeNull()
      act(() => resolveSecond(makeApiCollection({ id: 2, name: 'Second' })))
      await waitFor(() => expect(result.current.detail?.name).toBe('Second'))
      expect(result.current.detailLoading).toBe(false)
    })

    it('maps a 404 to the not-found message and other errors to their detail', async () => {
      fetchCollectionMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
      const { result, rerender } = renderData({ selectedCollectionId: 9 })
      await waitFor(() => expect(result.current.detailError).toBe(COLLECTION_NOT_FOUND_MESSAGE))
      expect(result.current.detail).toBeNull()

      fetchCollectionMock.mockRejectedValueOnce(new ApiError(403, 'Boom'))
      rerender({ selectedCollectionId: 10 })
      await waitFor(() => expect(result.current.detailError).toBe('Boom'))

      fetchCollectionMock.mockRejectedValueOnce(new ApiError(500, 'stack trace'))
      rerender({ selectedCollectionId: 11 })
      await waitFor(() => expect(result.current.detailError).toBe('Failed to load collection.'))
    })

    it('resets detail state when the selection is cleared', async () => {
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1 }))
      const { result, rerender } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail).not.toBeNull())
      rerender({ selectedCollectionId: null })
      expect(result.current.detail).toBeNull()
      expect(result.current.detailError).toBeNull()
      expect(result.current.detailLoading).toBe(false)
    })

    it('loadCollection maps a fetched collection without touching detail state', async () => {
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 5, program_ids: [2] }))
      const { result } = renderData()
      const loaded = await result.current.loadCollection(5)
      expect(loaded).toMatchObject({ id: 5, programIds: [2] })
      expect(result.current.detail).toBeNull()
    })
  })

  describe('mutations', () => {
    it('create posts an empty image list, prepends the result and refreshes in the background', async () => {
      createCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 42, name: 'Skulls', type: 'sequence' }),
      )
      const { result } = renderData()
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))
      fetchCollectionsMock.mockRejectedValueOnce(new ApiError(403, 'Refresh failed'))

      let created: Awaited<ReturnType<typeof result.current.create>> | undefined
      await act(async () => {
        created = await result.current.create({
          ...VALUES,
          visibility: 'restricted',
          programIds: [1],
          groupIds: [10],
        })
      })
      expect(createCollectionMock).toHaveBeenCalledWith({
        name: 'Skulls',
        description: 'Frontal vs lateral',
        type: 'sequence',
        visibility: 'restricted',
        image_ids: [],
        program_ids: [1],
        group_ids: [10],
      })
      expect(created).toMatchObject({ id: 42, name: 'Skulls' })
      expect(result.current.collections.map((c) => c.id)).toEqual([42])
      await waitFor(() => expect(result.current.error).toBe('Refresh failed'))
      expect(result.current.collections.map((c) => c.id)).toEqual([42])
    })

    it('create does not prepend a row hidden by the active filters', async () => {
      createCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 42, type: 'sequence' }))
      const { result } = renderData()
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))
      act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, type: 'synchronized' }))
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))
      await act(async () => {
        await result.current.create({ ...VALUES, type: 'sequence' })
      })
      expect(result.current.collections).toEqual([])
    })

    it('update sends a diff against the baseline and replaces the row and detail', async () => {
      fetchCollectionsMock.mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Old', version: 2 }),
        makeApiCollectionSummary({ id: 2, name: 'Other' }),
      ])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, name: 'Old', version: 2 }),
      )
      updateCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, name: 'New', version: 3 }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.name).toBe('Old'))
      await waitFor(() => expect(result.current.collections).toHaveLength(2))
      // Background refresh after the save hangs so the optimistic row is observable.
      fetchCollectionsMock.mockImplementationOnce(() => new Promise(() => {}))

      const baseline = makeCollection({
        id: 1,
        name: 'Old',
        description: 'Frontal vs lateral',
        visibility: 'private',
        version: 2,
      })
      await act(async () => {
        await result.current.update(
          1,
          { ...VALUES, name: 'New', type: 'synchronized' },
          2,
          baseline,
        )
      })
      expect(updateCollectionMock).toHaveBeenCalledWith(1, { name: 'New', version: 2 })
      expect(result.current.detail).toMatchObject({ id: 1, name: 'New', version: 3 })
      expect(result.current.collections.map((c) => c.name)).toEqual(['New', 'Other'])
    })

    it('update propagates API errors without touching state', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1, name: 'Old' })])
      updateCollectionMock.mockRejectedValueOnce(new ApiError(409, 'Stale'))
      const { result } = renderData()
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      await expect(result.current.update(1, VALUES, 1, null)).rejects.toBeInstanceOf(ApiError)
      expect(result.current.collections[0].name).toBe('Old')
    })

    it('remove drops the row and detail immediately, then refreshes', async () => {
      fetchCollectionsMock.mockResolvedValueOnce([
        makeApiCollectionSummary({ id: 1 }),
        makeApiCollectionSummary({ id: 2 }),
      ])
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1 }))
      deleteCollectionMock.mockResolvedValueOnce(undefined)
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.collections).toHaveLength(2))
      await waitFor(() => expect(result.current.detail?.id).toBe(1))
      fetchCollectionsMock.mockResolvedValueOnce([makeApiCollectionSummary({ id: 2 })])
      await act(async () => {
        await result.current.remove(1)
      })
      expect(deleteCollectionMock).toHaveBeenCalledWith(1)
      expect(result.current.collections.map((c) => c.id)).toEqual([2])
      expect(result.current.detail).toBeNull()
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))
    })
  })
})
