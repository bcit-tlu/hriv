import { useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { User, Role } from './types'
import { AuthContext } from './authContextValue'
import {
  fetchUsers as apiFetchUsers,
  loginUser as apiLoginUser,
  createUser as apiCreateUser,
  deleteUser as apiDeleteUser,
  setToken,
  getToken,
} from './api'
import type { ApiUser } from './api'

// Capture the URL fragment immediately at module-load time.  In React,
// children’s effects fire before their parents’ effects.  App (a child of
// AuthProvider) has a URL-sync effect that calls
//   window.history.replaceState(null, "", window.location.pathname)
// on mount, which strips the hash *before* our useEffect can read it.
// By snapshotting the hash here we guarantee we see the original value.
const _initialHash = window.location.hash.replace(/^#/, '')

function toUser(u: ApiUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    program_id: u.program_id,
    program_name: u.program_name,
    lastAccess: u.last_access,
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  // Read the OIDC error code (if any) from the URL fragment synchronously
  // during initial render. This avoids calling ``setState`` inside a
  // ``useEffect`` (which the react-hooks/set-state-in-effect rule flags
  // as a cascading render). The effect below is responsible for
  // stripping the fragment from the URL — no state update required
  // since the initial value is already captured here.
  const [oidcError, setOidcError] = useState<string | null>(() => {
    const params = new URLSearchParams(_initialHash)
    return params.get('oidc_error')
  })

  // On mount, try to restore session from stored token by fetching users
  // If the token is invalid the API will 401 and we clear it
  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetchUsers()
      setUsers(data.map(toUser))
    } catch (err) {
      console.error('Failed to load users', err)
      // If we get a 401, clear the stored token
      if (err instanceof Error && err.message.includes('401')) {
        setToken(null)
        setCurrentUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // On mount, check the URL fragment (returned after an IdP callback)
  // for either the success JWT (``oidc_token``) or an error code
  // (``oidc_error``). A fragment is used for both so neither lands in
  // server access logs. Whichever arrives, we strip it from the URL
  // afterwards so it can't be bookmarked, shared, or replayed. The
  // error code itself is captured in the ``oidcError`` state initializer
  // above; here we only handle side effects (persisting the token,
  // logging, and URL cleanup).
  useEffect(() => {
    const params = new URLSearchParams(_initialHash)
    const oidcToken = params.get('oidc_token')
    const oidcErr = params.get('oidc_error')
    if (oidcToken) {
      setToken(oidcToken)
      params.delete('oidc_token')
    }
    if (oidcErr) {
      // Log the raw code for developer debugging; LoginScreen maps the
      // code to a user-facing message.
      console.warn('OIDC callback returned error:', oidcErr)
      params.delete('oidc_error')
    }
    if (oidcToken || oidcErr) {
      const remaining = params.toString()
      const cleanUrl = window.location.pathname + window.location.search + (remaining ? `#${remaining}` : '')
      window.history.replaceState({}, '', cleanUrl)
    }
  }, [])

  const clearOidcError = useCallback(() => {
    setOidcError(null)
  }, [])

  // On mount, validate stored token by calling a protected endpoint.
  // If the token is expired or the DB was recreated, clear session.
  // Migrate legacy localStorage key from previous "corgi" branding
  useEffect(() => {
    if (localStorage.getItem('corgi_user') && !localStorage.getItem('hriv_user')) {
      localStorage.setItem('hriv_user', localStorage.getItem('corgi_user')!)
      localStorage.removeItem('corgi_user')
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('hriv_user')
    const token = getToken()
    if (!token || !stored) {
      // If we just got an OIDC token but have no stored user yet, still
      // attempt validation so the session is bootstrapped.
      if (!token) {
        setLoading(false)
        return
      }
    }

    if (stored) {
      try {
        JSON.parse(stored)
      } catch {
        setToken(null)
        localStorage.removeItem('hriv_user')
        setLoading(false)
        return
      }
    }

    // Validate the token via /auth/me (accessible by any authenticated role)
    fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json()
          const freshUser = toUser(data)
          setCurrentUser(freshUser)
          localStorage.setItem('hriv_user', JSON.stringify(freshUser))
        } else {
          // Token invalid or user no longer exists — clear session
          setToken(null)
          localStorage.removeItem('hriv_user')
        }
      })
      .catch(() => {
        // Network error — clear session to be safe
        setToken(null)
        localStorage.removeItem('hriv_user')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  // Load users list when an admin is authenticated
  useEffect(() => {
    if (currentUser?.role === 'admin') {
      loadUsers()
    }
  }, [currentUser, loadUsers])

  const login = useCallback(
    async (email: string, password: string) => {
      const resp = await apiLoginUser(email, password)
      setToken(resp.access_token)
      const user = toUser(resp.user)
      setCurrentUser(user)
      localStorage.setItem('hriv_user', JSON.stringify(user))
    },
    [],
  )

  const logout = useCallback(() => {
    setCurrentUser(null)
    setToken(null)
    localStorage.removeItem('hriv_user')
  }, [])

  const addUser = useCallback(
    async (name: string, email: string, role: Role, password: string, programId?: number | null) => {
      try {
        const data = await apiCreateUser({ name, email, role, password, program_id: programId })
        const newUser = toUser(data)
        setUsers((prev) => [...prev, newUser])
      } catch (err) {
        console.error('Failed to add user', err)
      }
    },
    [],
  )

  const deleteUser = useCallback(
    async (userId: number) => {
      try {
        await apiDeleteUser(userId)
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        if (currentUser?.id === userId) {
          setCurrentUser(null)
          setToken(null)
          localStorage.removeItem('hriv_user')
        }
      } catch (err) {
        console.error('Failed to delete user', err)
      }
    },
    [currentUser],
  )

  const canManageUsers = currentUser?.role === 'admin'
  const canEditContent =
    currentUser?.role === 'admin' || currentUser?.role === 'instructor'

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        users,
        loading,
        login,
        logout,
        addUser,
        deleteUser,
        refreshUsers: loadUsers,
        canManageUsers,
        canEditContent,
        oidcError,
        clearOidcError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
