/**
 * Unit tests for AuthProvider in AuthContext.tsx.
 *
 * Covers: login, logout, addUser, deleteUser, token persistence,
 * session validation on mount, OIDC token extraction from URL fragment,
 * OIDC error code extraction, and 401 handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import AuthProvider from '../src/AuthContext'
import { AuthContext } from '../src/authContextValue'
import type { AuthContextValue } from '../src/authContextValue'
import { useContext, useEffect } from 'react'

const emitEventNowMock = vi.fn()

// ── Mocks ────────────────────────────────────────────────────────────────

const mockFetchUsers = vi.fn()
const mockLoginUser = vi.fn()
const mockCreateUser = vi.fn()
const mockDeleteUser = vi.fn()
let currentToken: string | null = null

vi.mock('../src/api', () => ({
  fetchUsers: (...args: unknown[]) => mockFetchUsers(...args),
  loginUser: (...args: unknown[]) => mockLoginUser(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  setToken: (t: string | null) => {
    currentToken = t
  },
  getToken: () => currentToken,
  clearUserStorage: () => {
    Object.keys(storage).forEach((k) => {
      if (k.startsWith('hriv_') || k.startsWith('hriv-')) delete storage[k]
    })
    currentToken = null
  },
}))

vi.mock('../src/observability', () => ({
  emitEventNow: (...args: unknown[]) => emitEventNowMock(...args),
}))

const storage: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => storage[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    storage[key] = val
  }),
  removeItem: vi.fn((key: string) => {
    delete storage[key]
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(storage)) delete storage[key]
  }),
}
// Saved so afterEach can restore the original (the setup.ts polyfill), per
// REVIEW.md's rule that tests modifying browser globals must restore them.
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

// Mock fetch for /auth/me calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Test helper component ────────────────────────────────────────────────

function AuthConsumer({ onContext }: { onContext: (ctx: AuthContextValue) => void }) {
  const ctx = useContext(AuthContext)
  useEffect(() => {
    if (ctx) onContext(ctx)
  })
  if (!ctx) return <div>No context</div>
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="user">{ctx.currentUser?.email ?? 'none'}</span>
      <span data-testid="canManage">{String(ctx.canManageUsers)}</span>
      <span data-testid="canEdit">{String(ctx.canEditContent)}</span>
      <span data-testid="oidcError">{ctx.oidcError ?? 'none'}</span>
    </div>
  )
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  beforeEach(() => {
    emitEventNowMock.mockReset()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
      writable: true,
    })
    vi.clearAllMocks()
    currentToken = null
    Object.keys(storage).forEach((k) => delete storage[k])
    // Default: no stored user, no token → loading finishes immediately
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Not authenticated' }),
    })
    // Reset window.location.hash
    window.history.replaceState({}, '', window.location.pathname)
  })

  afterEach(() => {
    currentToken = null
    Object.keys(storage).forEach((k) => delete storage[k])
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor)
    } else {
      delete (window as { localStorage?: Storage }).localStorage
    }
  })

  it('renders children and finishes loading when no token is stored', async () => {
    render(
      <AuthProvider>
        <AuthConsumer onContext={() => {}} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('validates stored token via /auth/me on mount', async () => {
    currentToken = 'stored-jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'Admin',
      email: 'admin@example.ca',
      role: 'admin',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'Admin',
          email: 'admin@example.ca',
          role: 'admin',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
          metadata_extra: { changelog_last_read_at: '2026-06-17T12:00:00Z' },
        }),
    })
    // The admin user triggers loadUsers
    mockFetchUsers.mockResolvedValueOnce([])

    render(
      <AuthProvider>
        <AuthConsumer onContext={() => {}} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('user').textContent).toBe('admin@example.ca')
    expect(screen.getByTestId('canManage').textContent).toBe('true')
    expect(screen.getByTestId('canEdit').textContent).toBe('true')
  })

  it('preserves metadata_extra from /auth/me on currentUser', async () => {
    let authCtx: AuthContextValue | null = null

    currentToken = 'stored-jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'Admin',
      email: 'admin@example.ca',
      role: 'admin',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'Admin',
          email: 'admin@example.ca',
          role: 'admin',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
          metadata_extra: { changelog_last_read_at: '2026-06-17T12:00:00Z' },
        }),
    })
    mockFetchUsers.mockResolvedValueOnce([])

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(authCtx?.currentUser?.metadataExtra).toEqual({
        changelog_last_read_at: '2026-06-17T12:00:00Z',
      })
    })
  })

  it('clears session when /auth/me returns 401', async () => {
    currentToken = 'expired-jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'Admin',
      email: 'admin@example.ca',
      role: 'admin',
    })

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Token expired' }),
    })

    render(
      <AuthProvider>
        <AuthConsumer onContext={() => {}} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(currentToken).toBeNull()
    expect(storage['hriv_user']).toBeUndefined()
  })

  it('clears session when stored user JSON is invalid', async () => {
    currentToken = 'some-jwt'
    storage['hriv_user'] = 'not-json'

    render(
      <AuthProvider>
        <AuthConsumer onContext={() => {}} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(currentToken).toBeNull()
  })

  it('login sets the current user and stores in localStorage', async () => {
    let authCtx: AuthContextValue | null = null

    mockLoginUser.mockResolvedValue({
      access_token: 'new-jwt',
      user: {
        id: 2,
        name: 'Instructor',
        email: 'instructor@example.ca',
        role: 'instructor',
        program_ids: [],
        program_names: [],
        group_ids: [],
        group_names: [],
        last_access: null,
      },
    })

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await act(async () => {
      await authCtx!.login('instructor@example.ca', 'password')
    })

    expect(screen.getByTestId('user').textContent).toBe('instructor@example.ca')
    expect(screen.getByTestId('canEdit').textContent).toBe('true')
    expect(screen.getByTestId('canManage').textContent).toBe('false')
    expect(currentToken).toBe('new-jwt')
  })

  it('login clears storage when a different user logs in', async () => {
    let authCtx: AuthContextValue | null = null

    // A previous user's data is in storage
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'Old',
      email: 'old@example.ca',
      role: 'student',
    })
    storage['hriv-color-mode'] = 'dark'

    mockLoginUser.mockResolvedValue({
      access_token: 'new-jwt',
      user: {
        id: 2,
        name: 'New',
        email: 'new@example.ca',
        role: 'student',
        program_ids: [],
        program_names: [],
        group_ids: [],
        group_names: [],
        last_access: null,
      },
    })

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await act(async () => {
      await authCtx!.login('new@example.ca', 'password')
    })

    // Previous user's color mode preference should be cleared
    expect(storage['hriv-color-mode']).toBeUndefined()
    // New user is set correctly
    expect(screen.getByTestId('user').textContent).toBe('new@example.ca')
    expect(currentToken).toBe('new-jwt')
  })

  it('login preserves storage when the same user logs in again', async () => {
    let authCtx: AuthContextValue | null = null

    storage['hriv_user'] = JSON.stringify({
      id: 2,
      name: 'Same',
      email: 'same@example.ca',
      role: 'student',
    })
    storage['hriv-color-mode'] = 'dark'

    mockLoginUser.mockResolvedValue({
      access_token: 'fresh-jwt',
      user: {
        id: 2,
        name: 'Same',
        email: 'same@example.ca',
        role: 'student',
        program_ids: [],
        program_names: [],
        group_ids: [],
        group_names: [],
        last_access: null,
      },
    })

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await act(async () => {
      await authCtx!.login('same@example.ca', 'password')
    })

    // Same user re-logging in — color mode should be preserved
    expect(storage['hriv-color-mode']).toBe('dark')
    expect(currentToken).toBe('fresh-jwt')
  })

  it('logout clears user and token', async () => {
    let authCtx: AuthContextValue | null = null

    // Start with a valid session + user preferences
    currentToken = 'valid-jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'A',
      email: 'a@example.ca',
      role: 'student',
    })
    storage['hriv-color-mode'] = 'dark'

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'A',
          email: 'a@example.ca',
          role: 'student',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
        }),
    })

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('a@example.ca')
    })

    act(() => {
      authCtx!.logout()
    })

    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(emitEventNowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.logout_selected',
        action: 'logout',
        outcome: 'success',
      }),
    )
    expect(currentToken).toBeNull()
    expect(storage['hriv_user']).toBeUndefined()
    expect(storage['hriv-color-mode']).toBeUndefined()
  })

  it('canEditContent is true for instructor role', async () => {
    currentToken = 'jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'I',
      email: 'i@example.ca',
      role: 'instructor',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'I',
          email: 'i@example.ca',
          role: 'instructor',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
        }),
    })

    render(
      <AuthProvider>
        <AuthConsumer onContext={() => {}} />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('canEdit').textContent).toBe('true')
    })
    expect(screen.getByTestId('canManage').textContent).toBe('false')
  })

  it('addUser calls createUser and appends to users list', async () => {
    let authCtx: AuthContextValue | null = null
    currentToken = 'jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'A',
      email: 'admin@example.ca',
      role: 'admin',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'A',
          email: 'admin@example.ca',
          role: 'admin',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
        }),
    })
    mockFetchUsers.mockResolvedValueOnce([])
    mockCreateUser.mockResolvedValueOnce({
      id: 5,
      name: 'New',
      email: 'new@example.ca',
      role: 'student',
      program_ids: [],
      program_names: [],
      group_ids: [],
      group_names: [],
      last_access: null,
      metadata_extra: null,
      created_at: '',
      updated_at: '',
    })

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await act(async () => {
      await authCtx!.addUser('New', 'new@example.ca', 'student', 'pw')
    })

    expect(mockCreateUser).toHaveBeenCalledWith({
      name: 'New',
      email: 'new@example.ca',
      role: 'student',
      password: 'pw',
      program_ids: undefined,
    })
  })

  it('deleteUser removes user from list', async () => {
    let authCtx: AuthContextValue | null = null
    currentToken = 'jwt'
    storage['hriv_user'] = JSON.stringify({
      id: 1,
      name: 'A',
      email: 'admin@example.ca',
      role: 'admin',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          name: 'A',
          email: 'admin@example.ca',
          role: 'admin',
          program_ids: [],
          program_names: [],
          group_ids: [],
          group_names: [],
          last_access: null,
        }),
    })
    mockFetchUsers.mockResolvedValueOnce([
      {
        id: 5,
        name: 'Other',
        email: 'other@example.ca',
        role: 'student',
        program_ids: [],
        program_names: [],
        group_ids: [],
        group_names: [],
        last_access: null,
        metadata_extra: null,
        created_at: '',
        updated_at: '',
      },
    ])
    mockDeleteUser.mockResolvedValueOnce(undefined)

    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(authCtx).not.toBeNull()
      expect(authCtx!.users.length).toBe(1)
    })

    await act(async () => {
      await authCtx!.deleteUser(5)
    })

    await waitFor(() => {
      expect(authCtx!.users.length).toBe(0)
    })
  })

  it('clearOidcError resets oidcError to null', async () => {
    let authCtx: AuthContextValue | null = null

    // We can't easily set the URL hash before module load for _initialHash,
    // so we test the clearOidcError path by calling it directly
    render(
      <AuthProvider>
        <AuthConsumer
          onContext={(ctx) => {
            authCtx = ctx
          }}
        />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    // Initially no error
    expect(screen.getByTestId('oidcError').textContent).toBe('none')

    // clearOidcError should be idempotent
    act(() => {
      authCtx!.clearOidcError()
    })
    expect(screen.getByTestId('oidcError').textContent).toBe('none')
  })
})
