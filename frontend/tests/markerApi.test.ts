import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../src/components/markerFixtures'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(MARKER_FIXTURE)))
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
  { name: 'Marker detail', call: () => api.fetchMarker(7), method: 'GET', path: '/markers/7' },
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
    name: 'Board Marker order',
    call: () => api.reorderBoardMarkers(1, { items: [{ marker_id: 7 }], version: 5 }),
    method: 'PUT',
    path: '/boards/1/markers/order',
    body: { items: [{ marker_id: 7 }], version: 5 },
  },
  {
    name: 'remove Board Marker',
    call: () => api.removeBoardMarker(1, 7, 5),
    method: 'DELETE',
    path: '/boards/1/markers/7',
    version: 5,
  },
  { name: 'list Markers', call: () => api.fetchMarkers(), method: 'GET', path: '/markers' },
  {
    name: 'image Markers',
    call: () => api.fetchImageMarkers(42),
    method: 'GET',
    path: '/images/42/markers',
  },
  {
    name: 'create Marker',
    call: () =>
      api.createMarker({
        title: 'New',
        image_id: 42,
        x: 0.2,
        y: 0.3,
        zoom: 2,
        rotation: 30,
        board_assignments: [{ board_id: 1 }],
      }),
    method: 'POST',
    path: '/markers',
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
    name: 'update Marker',
    call: () => api.updateMarker(7, { title: 'New', version: 3 }),
    method: 'PATCH',
    path: '/markers/7',
    body: { title: 'New', version: 3 },
  },
  {
    name: 'delete Marker',
    call: () => api.deleteMarker(7, 3),
    method: 'DELETE',
    path: '/markers/7',
    version: 3,
  },
  {
    name: 'Marker order',
    call: () => api.reorderMarkers([{ marker_id: 7, version: 3 }]),
    method: 'PUT',
    path: '/markers/order',
    body: { items: [{ marker_id: 7, version: 3 }] },
  },
  {
    name: 'Marker owners',
    call: () => api.replaceMarkerOwners(7, { user_ids: [9], version: 3 }),
    method: 'PUT',
    path: '/markers/7/owners',
    body: { user_ids: [9], version: 3 },
  },
]
describe('Board / Marker API contracts', () => {
  it.each([
    null,
    {},
    { ...MARKER_FIXTURE, id: '7' },
    { ...MARKER_FIXTURE, version: null },
    { ...MARKER_FIXTURE, title: undefined },
    { ...MARKER_FIXTURE, description: false },
    { ...MARKER_FIXTURE, favourite: 'true' },
    { ...MARKER_FIXTURE, board_ids: null },
    { ...MARKER_FIXTURE, board_ids: ['1'] },
    { ...MARKER_FIXTURE, permissions: null },
    { ...MARKER_FIXTURE, permissions: { can_edit: true } },
    { ...MARKER_FIXTURE, permissions: { can_edit: 'true', can_delete: false } },
    { ...MARKER_FIXTURE, permissions: { can_edit: true, can_delete: 1 } },
  ])('rejects malformed conflict fields consumed by reload (%#)', (detail: unknown) => {
    expect(api.markerConflictCurrent(new api.ApiError(409, 'stale', detail))).toBeNull()
  })
  it('returns only a validated editable projection type without requiring unused response fields', () => {
    const { id, version, title, description, favourite, board_ids, permissions } = MARKER_FIXTURE
    const current: api.MarkerConflict = {
      id,
      version,
      title,
      description,
      favourite,
      board_ids,
      permissions,
    }
    expect(api.markerConflictCurrent(new api.ApiError(409, 'stale', current))).toBe(current)
  })
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
    await api.fetchMarkers({
      board_id: 1,

      image_id: 42,
      favourite: false,
      scope: 'mine',
      limit: 10,
    })
    const filtered = new URL(fetchMock.mock.calls[1][0], 'http://localhost').searchParams
    expect(Object.fromEntries(filtered)).toEqual({
      board_id: '1',

      image_id: '42',
      favourite: 'false',
      scope: 'mine',
      limit: '10',
    })
  })
  it('preserves RequestInit cancellation on reads and propagates API failures', async () => {
    const controller = new AbortController()
    await api.fetchImageMarkers(42, { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: MARKER_FIXTURE }), { status: 409 }),
    )
    const error = await api.updateMarker(7, { version: 2 }).catch((err) => err)
    expect(api.markerConflictCurrent(error)).toEqual(MARKER_FIXTURE)
    expect(api.markerConflictCurrent(new api.ApiError(422, 'bad', MARKER_FIXTURE))).toBeNull()
    expect(api.markerConflictCurrent(new api.ApiError(409, 'bad', BOARD_FIXTURE))).toBeNull()
  })
  it('returns empty lists and handles no-content deletes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await api.fetchMarkers()).toEqual([])
    await expect(api.deleteMarker(7, 3)).resolves.toBeUndefined()
  })
})
