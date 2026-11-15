import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from '../src/components/inuksukFixtures'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(INUKSUK_FIXTURE)))
})
afterEach(() => vi.unstubAllGlobals())

const cases: {
  name: string
  call: () => Promise<unknown>
  method: string
  path: string
  body?: unknown
  version?: number
}[] = [
  { name: 'list Boards', call: () => api.fetchBoards(), method: 'GET', path: '/boards' },
  { name: 'Board detail', call: () => api.fetchBoard(1), method: 'GET', path: '/boards/1' },
  {
    name: 'create Board',
    call: () => api.createBoard({ name: 'New', visibility: 'private' }),
    method: 'POST',
    path: '/boards',
    body: { name: 'New', visibility: 'private' },
  },
  {
    name: 'update Board',
    call: () => api.updateBoard(1, { name: 'New', version: 5 }),
    method: 'PATCH',
    path: '/boards/1',
    body: { name: 'New', version: 5 },
  },
  {
    name: 'delete Board',
    call: () => api.deleteBoard(1, 5),
    method: 'DELETE',
    path: '/boards/1',
    version: 5,
  },
  {
    name: 'Board order',
    call: () => api.reorderBoards([{ board_id: 1, version: 5 }]),
    method: 'PUT',
    path: '/boards/order',
    body: { items: [{ board_id: 1, version: 5 }] },
  },
  {
    name: 'Board owners',
    call: () => api.replaceBoardOwners(1, { user_ids: [9], version: 5 }),
    method: 'PUT',
    path: '/boards/1/owners',
    body: { user_ids: [9], version: 5 },
  },
  {
    name: 'Board transfer',
    call: () => api.transferBoard(1, { program_id: null, version: 5 }),
    method: 'POST',
    path: '/boards/1/transfer',
    body: { program_id: null, version: 5 },
  },
  {
    name: 'create Section',
    call: () => api.createBoardSection(1, { name: 'Section', version: 5 }),
    method: 'POST',
    path: '/boards/1/sections',
    body: { name: 'Section', version: 5 },
  },
  {
    name: 'update Section',
    call: () => api.updateBoardSection(1, 11, { name: 'Section', version: 5 }),
    method: 'PATCH',
    path: '/boards/1/sections/11',
    body: { name: 'Section', version: 5 },
  },
  {
    name: 'delete Section',
    call: () => api.deleteBoardSection(1, 11, 5),
    method: 'DELETE',
    path: '/boards/1/sections/11',
    version: 5,
  },
  {
    name: 'Section order',
    call: () => api.reorderBoardSections(1, { section_ids: [11], version: 5 }),
    method: 'PUT',
    path: '/boards/1/sections/order',
    body: { section_ids: [11], version: 5 },
  },
  {
    name: 'Board Inuksuk order',
    call: () =>
      api.reorderBoardInuksuks(1, { items: [{ inuksuk_id: 7, section_id: null }], version: 5 }),
    method: 'PUT',
    path: '/boards/1/inuksuks/order',
    body: { items: [{ inuksuk_id: 7, section_id: null }], version: 5 },
  },
  {
    name: 'remove Board Inuksuk',
    call: () => api.removeBoardInuksuk(1, 7, 5),
    method: 'DELETE',
    path: '/boards/1/inuksuks/7',
    version: 5,
  },
  { name: 'list Inuksuks', call: () => api.fetchInuksuks(), method: 'GET', path: '/inuksuks' },
  {
    name: 'image Inuksuks',
    call: () => api.fetchImageInuksuks(42),
    method: 'GET',
    path: '/images/42/inuksuks',
  },
  {
    name: 'create Inuksuk',
    call: () =>
      api.createInuksuk({
        title: 'New',
        image_id: 42,
        x: 0.2,
        y: 0.3,
        zoom: 2,
        rotation: 30,
        board_assignments: [{ board_id: 1 }],
      }),
    method: 'POST',
    path: '/inuksuks',
    body: {
      title: 'New',
      image_id: 42,
      x: 0.2,
      y: 0.3,
      zoom: 2,
      rotation: 30,
      board_assignments: [{ board_id: 1 }],
    },
  },
  {
    name: 'update Inuksuk',
    call: () => api.updateInuksuk(7, { title: 'New', version: 3 }),
    method: 'PATCH',
    path: '/inuksuks/7',
    body: { title: 'New', version: 3 },
  },
  {
    name: 'delete Inuksuk',
    call: () => api.deleteInuksuk(7, 3),
    method: 'DELETE',
    path: '/inuksuks/7',
    version: 3,
  },
  {
    name: 'Inuksuk order',
    call: () => api.reorderInuksuks([{ inuksuk_id: 7, version: 3 }]),
    method: 'PUT',
    path: '/inuksuks/order',
    body: { items: [{ inuksuk_id: 7, version: 3 }] },
  },
  {
    name: 'Inuksuk owners',
    call: () => api.replaceInuksukOwners(7, { user_ids: [9], version: 3 }),
    method: 'PUT',
    path: '/inuksuks/7/owners',
    body: { user_ids: [9], version: 3 },
  },
]
describe('Board / Section / Inuksuk API contracts', () => {
  it.each(cases)('$name', async ({ call, method, path, body, version }) => {
    await call()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api' + path)
    expect(init.method ?? 'GET').toBe(method)
    expect(init.body ? JSON.parse(init.body) : undefined).toEqual(body)
    if (version) expect(new Headers(init.headers).get('If-Match')).toBe(`"${version}"`)
  })
  it('encodes repeated visibility, search, paging and false favourite without dropping them', async () => {
    await api.fetchBoards({
      q: 'a & b',
      visibility: ['private', 'public'],
      sort: 'name',
      order: 'asc',
      page: 2,
      page_size: 10,
    })
    const query = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams
    expect(query.getAll('visibility')).toEqual(['private', 'public'])
    expect(query.get('q')).toBe('a & b')
    expect(query.get('page')).toBe('2')
    await api.fetchInuksuks({
      board_id: 1,
      section_id: 11,
      image_id: 42,
      favourite: false,
      scope: 'mine',
      limit: 10,
    })
    const filtered = new URL(fetchMock.mock.calls[1][0], 'http://localhost').searchParams
    expect(Object.fromEntries(filtered)).toEqual({
      board_id: '1',
      section_id: '11',
      image_id: '42',
      favourite: 'false',
      scope: 'mine',
      limit: '10',
    })
  })
  it('preserves RequestInit cancellation on reads and propagates API failures', async () => {
    const controller = new AbortController()
    await api.fetchImageInuksuks(42, { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: INUKSUK_FIXTURE }), { status: 409 }),
    )
    const error = await api.updateInuksuk(7, { version: 2 }).catch((err) => err)
    expect(api.inuksukConflictCurrent(error)).toEqual(INUKSUK_FIXTURE)
    expect(api.inuksukConflictCurrent(new api.ApiError(422, 'bad', INUKSUK_FIXTURE))).toBeNull()
    expect(api.inuksukConflictCurrent(new api.ApiError(409, 'bad', BOARD_FIXTURE))).toBeNull()
  })
  it('returns empty lists and handles no-content deletes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await api.fetchInuksuks()).toEqual([])
    await expect(api.deleteInuksuk(7, 3)).resolves.toBeUndefined()
  })
})
