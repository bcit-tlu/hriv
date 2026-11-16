import { BOARD_FIXTURE, INUKSUK_FIXTURE } from './inuksukFixtures'
import type { ApiBoard, ApiInuksuk, Group, Program, User } from '../types'
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
  created_at: INUKSUK_FIXTURE.created_at,
  updated_at: INUKSUK_FIXTURE.updated_at,
}))
export const BOARD_GROUPS: Group[] = [
  {
    id: 1,
    name: 'Studio A',
    description: null,
    createdByUserId: 9,
    memberIds: [],
    instructorIds: [9],
    createdAt: INUKSUK_FIXTURE.created_at,
    updatedAt: INUKSUK_FIXTURE.updated_at,
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
export const BOARD_ITEMS: ApiInuksuk[] = [
  'Rose window',
  'Stone columns',
  'Tracery details',
  'The arcade',
  'A study in geometry',
  'Light through glass',
].map((title, index) => ({
  ...INUKSUK_FIXTURE,
  id: index + 7,
  title,
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
    inuksuk_count: BOARD_ITEMS.length,

    inuksuks: BOARD_ITEMS.map((item) => ({
      ...item,
    })),
  },
  {
    ...BOARD_FIXTURE,
    id: 3,
    name: 'Next studio project',

    inuksuks: [],
    inuksuk_count: 0,
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

    inuksuks: [],
    inuksuk_count: 0,
  },
]

export function installBoardsFetch(
  state: 'ready' | 'empty' | 'error' = 'ready',
  onWrite?: (path: string, body: unknown) => void,
  initialBoards: ApiBoard[] = BOARDS_FIXTURES,
) {
  const original = globalThis.fetch
  let boards = structuredClone(initialBoards)
  let items = structuredClone(BOARD_ITEMS)
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    )
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (
      !path.startsWith('/api/boards') &&
      !path.startsWith('/api/inuksuks') &&
      !path.startsWith('/api/users')
    )
      return original(input, init)
    if (state === 'error')
      return Response.json({ detail: 'Boards are temporarily unavailable.' }, { status: 503 })
    if (path.startsWith('/api/users'))
      return Response.json([], { headers: { 'X-Total-Count': '0' } })
    if (path === '/api/inuksuks' && method === 'GET') {
      let rows = state === 'empty' ? [] : items
      const boardId = Number(url.searchParams.get('board_id'))
      if (boardId) rows = boards.find((board) => board.id === boardId)?.inuksuks ?? []
      if (url.searchParams.get('favourite') === 'true') rows = rows.filter((item) => item.favourite)
      return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? 60)))
    }
    const itemId = Number(path.match(/^\/api\/inuksuks\/(\d+)$/)?.[1])
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

      inuksuks: [],
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
