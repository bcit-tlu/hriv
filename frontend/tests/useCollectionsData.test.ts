import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../src/api'
import type { User } from '../src/types'
import {
  DEFAULT_COLLECTION_FILTERS,
  COLLECTION_NOT_FOUND_MESSAGE,
  matchesCollectionFilters,
  normalizeCollectionFilters,
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
    replaceCollectionImages: vi.fn(),
    saveCollectionViewport: vi.fn(),
    transferCollection: vi.fn(),
  }
})

import {
  createCollection,
  deleteCollection,
  fetchCollection,
  fetchCollections,
  replaceCollectionImages,
  saveCollectionViewport,
  transferCollection,
  updateCollection,
} from '../src/api'

const fetchCollectionsMock = vi.mocked(fetchCollections)
const fetchCollectionMock = vi.mocked(fetchCollection)
const createCollectionMock = vi.mocked(createCollection)
const updateCollectionMock = vi.mocked(updateCollection)
const deleteCollectionMock = vi.mocked(deleteCollection)
const replaceCollectionImagesMock = vi.mocked(replaceCollectionImages)
const saveCollectionViewportMock = vi.mocked(saveCollectionViewport)
const transferCollectionMock = vi.mocked(transferCollection)

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

describe('normalizeCollectionFilters', () => {
  const userOwner = { kind: 'user', userId: 3, name: 'X' } as const
  const programOwner = { kind: 'program', programId: 4, name: 'P' } as const

  it('returns the same object when nothing needs dropping', () => {
    const filters = { type: 'sequence', mine: false, owner: userOwner } as const
    expect(normalizeCollectionFilters(filters, { role: 'instructor' })).toBe(filters)
    expect(normalizeCollectionFilters(DEFAULT_COLLECTION_FILTERS, { role: 'student' })).toBe(
      DEFAULT_COLLECTION_FILTERS,
    )
  })

  it('drops every owner facet for students, keeping type and mine', () => {
    for (const owner of [userOwner, programOwner, 'orphaned'] as const) {
      expect(
        normalizeCollectionFilters({ type: 'sequence', mine: true, owner }, { role: 'student' }),
      ).toEqual({ type: 'sequence', mine: true, owner: 'any' })
    }
  })

  it('drops orphaned for every non-admin but keeps explicit owners', () => {
    const orphaned = { type: 'all', mine: false, owner: 'orphaned' } as const
    expect(normalizeCollectionFilters(orphaned, { role: 'admin' })).toBe(orphaned)
    for (const user of [{ role: 'instructor' }, { role: 'staff' }, null] as const) {
      expect(normalizeCollectionFilters(orphaned, user)).toEqual({ ...orphaned, owner: 'any' })
      expect(normalizeCollectionFilters({ ...orphaned, owner: programOwner }, user)).toEqual({
        ...orphaned,
        owner: programOwner,
      })
    }
  })
})

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

  it('drops a stale owner facet when the current user becomes a student', async () => {
    const admin = makeUser({ id: 1, role: 'admin' })
    const student = makeUser({ id: 2, role: 'student' })
    const owner = { kind: 'user', userId: 9, name: 'Zed' } as const
    const { result, rerender } = renderData({}, admin)
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, owner }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({ owner_user_id: 9 })
    expect(result.current.filters.owner).toEqual(owner)

    rerender({ currentUser: student })
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(3))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({})
    expect(result.current.filters).toEqual(DEFAULT_COLLECTION_FILTERS)

    // A collection the student saves must not be hidden by the admin's leftover owner selection.
    createCollectionMock.mockResolvedValueOnce(
      makeApiCollection({ id: 42, owner: { user_id: 2, name: 'Student' } }),
    )
    fetchCollectionsMock.mockRejectedValueOnce(new ApiError(403, 'Refresh failed'))
    await act(async () => {
      await result.current.create(VALUES)
    })
    expect(result.current.collections.map((c) => c.id)).toEqual([42])
    await waitFor(() => expect(result.current.error).toBe('Refresh failed'))
    expect(result.current.collections.map((c) => c.id)).toEqual([42])
  })

  it("forgets a previous user's owner selection instead of restoring it for the next non-student", async () => {
    const admin = makeUser({ id: 1, role: 'admin' })
    const student = makeUser({ id: 2, role: 'student' })
    const instructor = makeUser({ id: 3, role: 'instructor' })
    const owner = { kind: 'user', userId: 9, name: 'Zed' } as const
    const { result, rerender } = renderData({}, admin)
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, owner }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))

    rerender({ currentUser: student })
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(3))
    expect(result.current.filters).toEqual(DEFAULT_COLLECTION_FILTERS)

    rerender({ currentUser: instructor })
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(4))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({})
    expect(result.current.filters).toEqual(DEFAULT_COLLECTION_FILTERS)

    // The new user can still pick their own owner filter.
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, owner }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(5))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({ owner_user_id: 9 })
  })

  it("does not keep the previous user's cards when the next account's load fails", async () => {
    const admin = makeUser({ id: 1, role: 'admin' })
    const student = makeUser({ id: 2, role: 'student' })
    fetchCollectionsMock.mockResolvedValueOnce([
      makeApiCollectionSummary({ id: 1, owner: { user_id: 9, name: 'Zed' } }),
    ])
    const { result, rerender } = renderData({}, admin)
    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual([1]))
    expect(result.current.ownerOptions).toHaveLength(1)

    fetchCollectionsMock.mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    rerender({ currentUser: student })
    await waitFor(() => expect(result.current.error).toBe('Forbidden'))
    expect(result.current.collections).toEqual([])
    expect(result.current.ownerOptions).toEqual([])
  })

  it('refreshes with the filters in effect when a save finishes, not those at its start', async () => {
    const { result } = renderData()
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))

    let resolveCreate!: (value: ReturnType<typeof makeApiCollection>) => void
    createCollectionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    let created: Promise<unknown>
    act(() => {
      created = result.current.create(VALUES)
    })
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, type: 'sequence' }))
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(2))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({ type: 'sequence' })

    fetchCollectionsMock.mockResolvedValueOnce([makeApiCollectionSummary({ id: 5 })])
    await act(async () => {
      resolveCreate(makeApiCollection({ id: 42 }))
      await created
    })
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(3))
    expect(fetchCollectionsMock).toHaveBeenLastCalledWith({ type: 'sequence' })
    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual([5]))
  })

  it('places a finished save against the current filters, not those at its start', async () => {
    const { result } = renderData()
    await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledTimes(1))

    let resolveCreate!: (value: ReturnType<typeof makeApiCollection>) => void
    createCollectionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    let created: Promise<unknown>
    act(() => {
      created = result.current.create({ ...VALUES, type: 'synchronized' })
    })
    // Switch to a filter the pending collection will not satisfy before it resolves.
    fetchCollectionsMock.mockResolvedValueOnce([
      makeApiCollectionSummary({ id: 5, type: 'sequence' }),
    ])
    act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, type: 'sequence' }))
    await waitFor(() => expect(result.current.collections.map((c) => c.id)).toEqual([5]))

    // A failed background refresh leaves the optimistic placement in charge.
    fetchCollectionsMock.mockRejectedValueOnce(new ApiError(403, 'Refresh failed'))
    await act(async () => {
      resolveCreate(makeApiCollection({ id: 42, type: 'synchronized' }))
      await created
    })
    await waitFor(() => expect(result.current.error).toBe('Refresh failed'))
    expect(result.current.collections.map((c) => c.id)).toEqual([5])
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

    it('reorderImages applies the order optimistically and sends the whole list (#1416)', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 5,
          images: [
            { id: 10, name: 'A' },
            { id: 11, name: 'B' },
            { id: 12, name: 'C' },
          ] as never,
        }),
      )
      replaceCollectionImagesMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 6,
          images: [{ id: 12 }, { id: 10 }, { id: 11 }] as never,
        }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() =>
        expect(result.current.detail?.images.map((i) => i.id)).toEqual([10, 11, 12]),
      )

      let reorderPromise!: Promise<unknown>
      await act(async () => {
        reorderPromise = result.current.reorderImages(1, [12, 10, 11])
      })
      // Optimistic order is visible before the PUT resolves.
      expect(result.current.detail?.images.map((i) => i.id)).toEqual([12, 10, 11])
      await act(async () => {
        await reorderPromise
      })
      expect(replaceCollectionImagesMock).toHaveBeenCalledWith(1, {
        image_ids: [12, 10, 11],
        version: 5,
      })
      expect(result.current.detail?.images.map((i) => i.id)).toEqual([12, 10, 11])
      expect(result.current.detail?.version).toBe(6)
    })

    it('reorderImages rolls detail back and propagates API errors', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 5,
          images: [{ id: 10 }, { id: 11 }] as never,
        }),
      )
      replaceCollectionImagesMock.mockRejectedValueOnce(new ApiError(409, 'Stale'))
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.images.map((i) => i.id)).toEqual([10, 11]))

      await expect(result.current.reorderImages(1, [11, 10])).rejects.toBeInstanceOf(ApiError)
      expect(result.current.detail?.images.map((i) => i.id)).toEqual([10, 11])
    })

    it('serializes overlapping reorders so the second PUT sees the new version', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 5,
          images: [{ id: 10 }, { id: 11 }, { id: 12 }] as never,
        }),
      )
      let resolveFirst!: (value: ReturnType<typeof makeApiCollection>) => void
      replaceCollectionImagesMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockResolvedValueOnce(
          makeApiCollection({
            id: 1,
            version: 7,
            images: [{ id: 12 }, { id: 11 }, { id: 10 }] as never,
          }),
        )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(5))

      // Two drops land while the first PUT is still in flight.
      let first!: Promise<unknown>
      let second!: Promise<unknown>
      await act(async () => {
        first = result.current.reorderImages(1, [12, 10, 11])
        second = result.current.reorderImages(1, [12, 11, 10])
      })
      expect(replaceCollectionImagesMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveFirst(
          makeApiCollection({
            id: 1,
            version: 6,
            images: [{ id: 12 }, { id: 10 }, { id: 11 }] as never,
          }),
        )
        await first
      })
      // The second PUT runs only now, carrying the first call's new version.
      await act(async () => {
        await second
      })
      expect(replaceCollectionImagesMock).toHaveBeenNthCalledWith(2, 1, {
        image_ids: [12, 11, 10],
        version: 6,
      })
      expect(result.current.detail?.images.map((i) => i.id)).toEqual([12, 11, 10])
      expect(result.current.detail?.version).toBe(7)
    })

    it('a queued reorder still persists but never overwrites another open detail', async () => {
      fetchCollectionsMock.mockResolvedValue([
        makeApiCollectionSummary({ id: 1 }),
        makeApiCollectionSummary({ id: 2 }),
      ])
      fetchCollectionMock
        .mockResolvedValueOnce(
          makeApiCollection({ id: 1, version: 5, images: [{ id: 10 }, { id: 11 }] as never }),
        )
        .mockResolvedValueOnce(makeApiCollection({ id: 2, name: 'Second', images: [] as never }))
      let resolveFirst!: (value: ReturnType<typeof makeApiCollection>) => void
      replaceCollectionImagesMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockResolvedValueOnce(
          makeApiCollection({ id: 1, version: 7, images: [{ id: 11 }, { id: 10 }] as never }),
        )
      const { result, rerender } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.id).toBe(1))

      let first!: Promise<unknown>
      let second!: Promise<unknown>
      await act(async () => {
        first = result.current.reorderImages(1, [11, 10])
        second = result.current.reorderImages(1, [11, 10])
      })
      // Navigate to collection 2 while both PUTs are queued/in flight.
      rerender({ selectedCollectionId: 2 })
      await waitFor(() => expect(result.current.detail?.id).toBe(2))

      await act(async () => {
        resolveFirst(
          makeApiCollection({ id: 1, version: 6, images: [{ id: 11 }, { id: 10 }] as never }),
        )
        await first
      })
      await act(async () => {
        await second
      })
      // Both PUTs persisted collection 1's reorder…
      expect(replaceCollectionImagesMock).toHaveBeenCalledTimes(2)
      expect(replaceCollectionImagesMock).toHaveBeenNthCalledWith(2, 1, {
        image_ids: [11, 10],
        version: 6,
      })
      // …but collection 2's open detail was never displaced.
      expect(result.current.detail?.id).toBe(2)
      expect(result.current.detail?.name).toBe('Second')
    })

    it('reorderImages refuses to run before the detail has loaded', async () => {
      const { result } = renderData()
      await expect(result.current.reorderImages(1, [1])).rejects.toThrow(
        'The collection is not loaded.',
      )
      expect(replaceCollectionImagesMock).not.toHaveBeenCalled()
    })

    it('saveViewport sends the whole state with version and updates detail (#1417)', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 5, images: [{ id: 10 }, { id: 11 }] as never }),
      )
      const viewportState = {
        '10': { zoom: 2, x: 0.4, y: 0.4, rotation: 0 },
        '11': { zoom: 3, x: 0.6, y: 0.5, rotation: 45 },
      }
      saveCollectionViewportMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 6, viewport_state: viewportState }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(5))

      await act(async () => {
        await result.current.saveViewport(1, viewportState)
      })
      expect(saveCollectionViewportMock).toHaveBeenCalledWith(1, {
        viewport_state: viewportState,
        version: 5,
      })
      expect(result.current.detail?.viewportState).toEqual(viewportState)
      expect(result.current.detail?.version).toBe(6)
    })

    it('saveViewport queues behind an in-flight reorder and uses its version', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 5,
          images: [{ id: 10 }, { id: 11 }] as never,
        }),
      )
      let resolveReorder!: (value: ReturnType<typeof makeApiCollection>) => void
      replaceCollectionImagesMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReorder = resolve
          }),
      )
      saveCollectionViewportMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 7, viewport_state: { '10': { zoom: 2 } } }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(5))

      let reorderPromise!: Promise<unknown>
      let savePromise!: Promise<unknown>
      await act(async () => {
        reorderPromise = result.current.reorderImages(1, [11, 10])
        savePromise = result.current.saveViewport(1, { '10': { zoom: 2 } })
      })
      // The viewport PUT waits for the reorder PUT to settle.
      expect(saveCollectionViewportMock).not.toHaveBeenCalled()
      await act(async () => {
        resolveReorder(
          makeApiCollection({
            id: 1,
            version: 6,
            images: [{ id: 11 }, { id: 10 }] as never,
          }),
        )
        await reorderPromise
      })
      await act(async () => {
        await savePromise
      })
      expect(saveCollectionViewportMock).toHaveBeenCalledWith(1, {
        viewport_state: { '10': { zoom: 2 } },
        version: 6,
      })
      expect(result.current.detail?.version).toBe(7)
    })

    it('saveViewport after a collection edit uses the edited version, not the queued one', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1, version: 5 }))
      saveCollectionViewportMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 6, viewport_state: { '10': { zoom: 2 } } }),
      )
      updateCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, name: 'Renamed', version: 7 }),
      )
      saveCollectionViewportMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 8, viewport_state: { '10': { zoom: 3 } } }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(5))

      await act(async () => {
        await result.current.saveViewport(1, { '10': { zoom: 2 } })
      })
      expect(saveCollectionViewportMock).toHaveBeenLastCalledWith(1, {
        viewport_state: { '10': { zoom: 2 } },
        version: 5,
      })
      await act(async () => {
        await result.current.update(1, { ...VALUES, name: 'Renamed' }, 6, null)
      })
      await act(async () => {
        await result.current.saveViewport(1, { '10': { zoom: 3 } })
      })
      // The second save must not reuse the first save's queued version 6.
      expect(saveCollectionViewportMock).toHaveBeenLastCalledWith(1, {
        viewport_state: { '10': { zoom: 3 } },
        version: 7,
      })
    })

    it('reorderImages after a collection edit uses the edited version, not the queued one', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 5, images: [{ id: 10 }, { id: 11 }] as never }),
      )
      replaceCollectionImagesMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 6, images: [{ id: 11 }, { id: 10 }] as never }),
      )
      updateCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, name: 'Renamed', version: 7 }),
      )
      replaceCollectionImagesMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 8, images: [{ id: 10 }, { id: 11 }] as never }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(5))

      await act(async () => {
        await result.current.reorderImages(1, [11, 10])
      })
      await act(async () => {
        await result.current.update(1, { ...VALUES, name: 'Renamed' }, 6, null)
      })
      await act(async () => {
        await result.current.reorderImages(1, [10, 11])
      })
      expect(replaceCollectionImagesMock).toHaveBeenLastCalledWith(1, {
        image_ids: [10, 11],
        version: 7,
      })
    })

    it('saveViewport never displaces another open detail', async () => {
      fetchCollectionsMock.mockResolvedValue([
        makeApiCollectionSummary({ id: 1 }),
        makeApiCollectionSummary({ id: 2 }),
      ])
      fetchCollectionMock
        .mockResolvedValueOnce(makeApiCollection({ id: 1, version: 5 }))
        .mockResolvedValueOnce(makeApiCollection({ id: 2, name: 'Second' }))
      saveCollectionViewportMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 6, viewport_state: { '10': { zoom: 2 } } }),
      )
      const { result, rerender } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.id).toBe(1))

      let savePromise!: Promise<unknown>
      await act(async () => {
        savePromise = result.current.saveViewport(1, { '10': { zoom: 2 } })
      })
      rerender({ selectedCollectionId: 2 })
      await waitFor(() => expect(result.current.detail?.id).toBe(2))
      await act(async () => {
        await savePromise
      })
      // Collection 1's save persisted but collection 2's detail stayed.
      expect(saveCollectionViewportMock).toHaveBeenCalledWith(1, {
        viewport_state: { '10': { zoom: 2 } },
        version: 5,
      })
      expect(result.current.detail?.id).toBe(2)
      expect(result.current.detail?.name).toBe('Second')
    })

    it('saveViewport refuses to run before the detail has loaded', async () => {
      const { result } = renderData()
      await expect(result.current.saveViewport(1, {})).rejects.toThrow(
        'The collection is not loaded.',
      )
      expect(saveCollectionViewportMock).not.toHaveBeenCalled()
    })

    it('renewCollectionImage swaps the member record inside detail', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, images: [{ id: 10 }, { id: 11 }] as never }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.images).toHaveLength(2))

      act(() => {
        result.current.renewCollectionImage(1, {
          id: 11,
          name: 'Renewed',
          thumb: '/thumbs/new.jpg?token=x',
          tile_sources: '/tiles/new.dzi?token=x',
        } as never)
      })
      const renewed = result.current.detail?.images.find((i) => i.id === 11)
      expect(renewed?.name).toBe('Renewed')
      expect(renewed?.thumb).toContain('token=x')
      // Other members untouched.
      expect(result.current.detail?.images[0].id).toBe(10)
    })

    it('transfer posts the target with the detail version and updates row + detail (#1419)', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1, version: 3 })])
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1, version: 3 }))
      transferCollectionMock.mockResolvedValueOnce(
        makeApiCollection({
          id: 1,
          version: 4,
          owner: { program_id: 2, name: 'Ultrasound' },
        }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(3))
      fetchCollectionsMock.mockImplementationOnce(() => new Promise(() => {}))

      await act(async () => {
        await result.current.transfer(1, { programId: 2 })
      })
      expect(transferCollectionMock).toHaveBeenCalledWith(1, { program_id: 2, version: 3 })
      expect(result.current.detail).toMatchObject({
        id: 1,
        version: 4,
        owner: { kind: 'program', programId: 2, name: 'Ultrasound' },
      })
      expect(result.current.collections[0].owner).toMatchObject({ kind: 'program', programId: 2 })
    })

    it('transfer fetches the record for its version when the collection is not open', async () => {
      // Card-level reassignment (e.g. an orphaned row): no detail is loaded, so
      // the hook fetches the freshest record before posting.
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 5, owner: null })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 5, owner: null, version: 7 }),
      )
      transferCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 5, version: 8, owner: { user_id: 9, name: 'New owner' } }),
      )
      const { result } = renderData()
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      fetchCollectionsMock.mockImplementationOnce(() => new Promise(() => {}))

      await act(async () => {
        await result.current.transfer(5, { userId: 9 })
      })
      expect(fetchCollectionMock).toHaveBeenCalledWith(5)
      expect(transferCollectionMock).toHaveBeenCalledWith(5, { user_id: 9, version: 7 })
      expect(result.current.collections[0].owner).toMatchObject({ kind: 'user', userId: 9 })
      expect(result.current.detail).toBeNull()
    })

    it('transfer drops the row when the new owner no longer matches the filters', async () => {
      // Under `mine`, transferring my collection to a program removes it.
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1, version: 1 }))
      transferCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, owner: { program_id: 2, name: 'Ultrasound' } }),
      )
      const { result } = renderData()
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, mine: true }))
      // Let the filter-triggered reload settle (the mock ignores `mine` and
      // returns the row again), then hang the transfer-triggered refresh so
      // the client-side filter decision is what's under test.
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledWith({ mine: true }))
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      fetchCollectionsMock.mockImplementationOnce(() => new Promise(() => {}))

      await act(async () => {
        await result.current.transfer(1, { programId: 2 })
      })
      expect(result.current.collections).toHaveLength(0)
    })

    it('transfer keeps an assigned row in the orphaned-filtered list out of view', async () => {
      // Under the admin `orphaned` facet, assigning an owner removes the row.
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 5, owner: null })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 5, owner: null, version: 1 }),
      )
      transferCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 5, version: 2, owner: { user_id: 9, name: 'New owner' } }),
      )
      const { result } = renderData({}, makeUser({ role: 'admin' }))
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      act(() => result.current.setFilters({ ...DEFAULT_COLLECTION_FILTERS, owner: 'orphaned' }))
      await waitFor(() => expect(fetchCollectionsMock).toHaveBeenCalledWith({ orphaned: true }))
      await waitFor(() => expect(result.current.collections).toHaveLength(1))
      fetchCollectionsMock.mockImplementationOnce(() => new Promise(() => {}))

      await act(async () => {
        await result.current.transfer(5, { userId: 9 })
      })
      expect(result.current.collections).toHaveLength(0)
    })

    it('transfer queues behind an in-flight reorder and sends its fresh version', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1, version: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 1, images: [{ id: 10 }, { id: 11 }] as never }),
      )
      let resolveReorder!: (c: ReturnType<typeof makeApiCollection>) => void
      replaceCollectionImagesMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReorder = resolve
          }),
      )
      transferCollectionMock.mockResolvedValueOnce(
        makeApiCollection({ id: 1, version: 3, owner: { program_id: 2, name: 'Ultrasound' } }),
      )
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.version).toBe(1))

      let reorderPromise!: Promise<unknown>
      let transferPromise!: Promise<unknown>
      await act(async () => {
        reorderPromise = result.current.reorderImages(1, [11, 10])
        transferPromise = result.current.transfer(1, { programId: 2 })
      })
      // The transfer must not post until the reorder's version bump lands.
      expect(transferCollectionMock).not.toHaveBeenCalled()
      await act(async () => {
        resolveReorder(makeApiCollection({ id: 1, version: 2 }))
        await reorderPromise
        await transferPromise
      })
      expect(transferCollectionMock).toHaveBeenCalledWith(1, { program_id: 2, version: 2 })
    })

    it('transfer propagates API errors without touching state', async () => {
      fetchCollectionsMock.mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
      fetchCollectionMock.mockResolvedValueOnce(makeApiCollection({ id: 1, version: 1 }))
      transferCollectionMock.mockRejectedValueOnce(new ApiError(403, 'Not yours to give'))
      const { result } = renderData({ selectedCollectionId: 1 })
      await waitFor(() => expect(result.current.detail?.id).toBe(1))

      await expect(result.current.transfer(1, { userId: 9 })).rejects.toBeInstanceOf(ApiError)
      expect(result.current.collections[0].owner).toMatchObject({ kind: 'user', userId: 7 })
    })
  })
})
