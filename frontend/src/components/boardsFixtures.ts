import { BOARD_FIXTURE, MARKER_FIXTURE } from './markerFixtures'
import type { ApiBoard, ApiMarker, Group, Program, User } from '../types'
import type { AuthContextValue } from '../authContextValue'

export const BOARD_USER: User = {
  id: 9,
  name: 'Alex',
  email: 'alex@example.com',
  role: 'instructor',
  active: true,
  program_ids: [1],
  program_names: ['Design'],
  group_ids: [],
  group_names: [],
}
export const BOARD_PROGRAMS: Program[] = [1, 2].map((id) => ({
  id,
  name: id === 1 ? 'Design' : 'Engineering',
  oidc_group: null,
  created_at: MARKER_FIXTURE.created_at,
  updated_at: MARKER_FIXTURE.updated_at,
}))
export const BOARD_GROUPS: Group[] = [
  {
    id: 1,
    name: 'Studio A',
    description: null,
    createdByUserId: 9,
    memberIds: [],
    instructorIds: [9],
    createdAt: MARKER_FIXTURE.created_at,
    updatedAt: MARKER_FIXTURE.updated_at,
  },
]
export const BOARD_AUTH: AuthContextValue = {
  currentUser: BOARD_USER,
  users: [],
  loading: false,
  login: async () => {},
  logout: () => {},
  addUser: () => {},
  deleteUser: () => {},
  refreshUsers: () => {},
  refreshCurrentUser: async () => {},
  canManageUsers: false,
  canEditContent: true,
  canViewPeople: false,
  oidcError: null,
  clearOidcError: () => {},
}
export const BOARD_ITEMS: ApiMarker[] = [
  'Rose window',
  'Stone columns',
  'Tracery details',
  'The arcade',
  'A study in geometry',
  'Light through glass',
].map((title, index) => ({
  ...MARKER_FIXTURE,
  id: index + 7,
  title,
  category_name: index === 5 ? null : 'Architectural details',
  thumb: '/hriv-splash2.jpg',
  description:
    index % 2
      ? null
      : 'A saved view for our architectural study. Compare the rhythm, structure and light.',
  favourite: index % 3 === 0,
}))
export const BOARDS_FIXTURES: ApiBoard[] = [
  {
    ...BOARD_FIXTURE,
    description: 'Details worth a second look — our studio inspiration board.',
    permissions: { ...BOARD_FIXTURE.permissions, can_transfer: true },
    marker_count: BOARD_ITEMS.length,

    markers: BOARD_ITEMS.map((item) => ({
      ...item,
    })),
  },
  {
    ...BOARD_FIXTURE,
    id: 3,
    name: 'Next studio project',

    markers: [],
    marker_count: 0,
  },
  {
    ...BOARD_FIXTURE,
    id: 2,
    name: 'Shared discoveries',
    visibility: 'public',
    owners: [{ user_id: 77, program_id: null, name: 'Morgan', role: 'instructor' }],
    permissions: {
      can_edit: false,
      can_change_scope: false,
      can_delete: false,
      can_transfer: false,
    },

    markers: [
      {
        ...BOARD_ITEMS[0],
        id: 90,
        title: 'Morgan’s shared view',
        owners: [{ user_id: 77, program_id: null, name: 'Morgan', role: 'instructor' }],
        board_ids: [2],
        permissions: { can_edit: false, can_delete: false },
      },
    ],
    marker_count: 1,
  },
]

export const BOARD_DISCOVERY_FIXTURES: ApiBoard[] = [
  ...BOARDS_FIXTURES,
  {
    ...BOARDS_FIXTURES[2],
    id: 5,
    name: 'Morgan’s private studies',
    visibility: 'private',
  },
  {
    ...BOARDS_FIXTURES[2],
    id: 6,
    name: 'Studio reference library',
    visibility: 'restricted',
    program_ids: [1],
    group_ids: [],
    owner_program_id: 2,
    owners: [{ user_id: null, program_id: 2, name: 'Engineering', role: null }],
  },
]

export function installBoardsFetch(
  state: 'ready' | 'empty' | 'error' = 'ready',
  onWrite?: (path: string, body: unknown) => void,
  initialBoards: ApiBoard[] = BOARDS_FIXTURES,
) {
  const original = globalThis.fetch
  let boards = structuredClone(initialBoards)
  let items = structuredClone([
    ...BOARD_ITEMS,
    ...initialBoards
      .flatMap((board) => board.markers)
      .filter((item) => !BOARD_ITEMS.some((owned) => owned.id === item.id)),
  ])
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    )
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (
      !path.startsWith('/api/boards') &&
      !path.startsWith('/api/markers') &&
      !path.startsWith('/api/users')
    )
      return original(input, init)
    if (state === 'error')
      return Response.json({ detail: 'Boards are temporarily unavailable.' }, { status: 503 })
    if (path.startsWith('/api/users'))
      return Response.json([], { headers: { 'X-Total-Count': '0' } })
    if (path === '/api/markers' && method === 'GET') {
      let rows = state === 'empty' ? [] : items
      const boardId = Number(url.searchParams.get('board_id'))
      if (boardId) rows = boards.find((board) => board.id === boardId)?.markers ?? []
      if (url.searchParams.get('favourite') === 'true') rows = rows.filter((item) => item.favourite)
      const pageSize = Number(
        url.searchParams.get('page_size') ?? url.searchParams.get('limit') ?? rows.length,
      )
      const start = (Number(url.searchParams.get('page') ?? 1) - 1) * pageSize
      return Response.json(rows.slice(start, start + pageSize))
    }
    const itemId = Number(path.match(/^\/api\/markers\/(\d+)$/)?.[1])
    if (itemId && method === 'GET') return Response.json(items.find((item) => item.id === itemId))
    if (path === '/api/boards' && method === 'GET')
      return Response.json(state === 'empty' ? [] : boards)
    const boardId = Number(path.match(/^\/api\/boards\/(\d+)/)?.[1])
    if (boardId && method === 'GET')
      return Response.json(boards.find((board) => board.id === boardId))
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null
    onWrite?.(path, body)
    if (
      path === '/api/boards/order' &&
      body &&
      typeof body === 'object' &&
      'items' in body &&
      Array.isArray(body.items)
    ) {
      const ids = body.items.flatMap((item) =>
        item && typeof item === 'object' && 'board_id' in item && typeof item.board_id === 'number'
          ? [item.board_id]
          : [],
      )
      ids.forEach((id, position) => {
        const board = boards.find((row) => row.id === id)
        if (board) {
          board.sort_order = position
          board.version += 1
        }
      })
      boards.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      return Response.json(boards)
    }
    if (
      itemId &&
      body &&
      typeof body === 'object' &&
      'board_assignments' in body &&
      Array.isArray(body.board_assignments)
    ) {
      const assignments = body.board_assignments.flatMap(
        (entry): { board_id: number; sort_order?: number }[] =>
          entry &&
          typeof entry === 'object' &&
          'board_id' in entry &&
          typeof entry.board_id === 'number'
            ? [
                {
                  board_id: entry.board_id,
                  ...('sort_order' in entry && typeof entry.sort_order === 'number'
                    ? { sort_order: entry.sort_order }
                    : {}),
                },
              ]
            : [],
      )
      const item = items.find((row) => row.id === itemId)
      if (!item) return Response.json({ detail: 'Marker not found' }, { status: 404 })
      const boardIds = [
        ...new Set([
          ...item.board_ids.filter(
            (id) => !boards.find((board) => board.id === id)?.permissions.can_edit,
          ),
          ...assignments.map((assignment) => assignment.board_id),
        ]),
      ]
      const saved = { ...item, board_ids: boardIds, version: item.version + 1 }
      items = items.map((row) => (row.id === itemId ? saved : row))
      boards = boards.map((board) => {
        const members = board.markers.filter((row) => row.id !== itemId)
        if (boardIds.includes(board.id))
          members.push({
            ...saved,
            sort_order:
              assignments.find((assignment) => assignment.board_id === board.id)?.sort_order ??
              members.length,
          })
        return { ...board, markers: members, marker_count: members.length }
      })
      return Response.json(saved)
    }
    if (
      itemId &&
      body &&
      typeof body === 'object' &&
      'favourite' in body &&
      typeof body.favourite === 'boolean'
    ) {
      const favourite = body.favourite
      items = items.map((item) =>
        item.id === itemId ? { ...item, favourite, version: item.version + 1 } : item,
      )
      return Response.json(items.find((item) => item.id === itemId))
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    const existing = boards.find((board) => board.id === boardId) ?? {
      ...BOARDS_FIXTURES[0],
      id: 40,

      markers: [],
    }
    const saved = {
      ...existing,
      ...(body && typeof body === 'object' && 'name' in body && typeof body.name === 'string'
        ? { name: body.name }
        : {}),
      version: existing.version + 1,
    }
    boards = [...boards.filter((board) => board.id !== saved.id), saved]
    return Response.json(saved)
  }
  return () => {
    globalThis.fetch = original
  }
}
