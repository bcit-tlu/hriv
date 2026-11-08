import { useState, useCallback, useEffect, useRef } from 'react'
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
  clearUserStorage as apiClearUserStorage,
  toUser,
  fetchCurrentUser,
  redeemPasswordSetup,
} from './api'
import type { LoginResponse } from './api'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import PasswordSetupScreen from './components/PasswordSetupScreen'
import { ForcedPasswordChangeScreen } from './components/ChangePasswordDialog'
import { emitEventNow } from './observability'
import { tileOrderingCoordinator } from './tileOrdering'

/**
 * Clear HRIV-scoped storage AND in-memory per-user state (the tile-ordering
 * coordinator caches display orders, revisions, and unsaved-change flags)
 * so nothing leaks to the next user on a shared browser.
 */
function clearUserStorage(): void {
  apiClearUserStorage()
  tileOrderingCoordinator.reset()
}

function persistCachedUser(user: User): void {
  localStorage.setItem(
    'hriv_user',
    JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      oidc_linked: user.oidc_linked,
      program_ids: user.program_ids,
      program_names: user.program_names,
      group_ids: user.group_ids,
      group_names: user.group_names,
      lastAccess: user.lastAccess,
      metadataExtra: user.metadataExtra,
    }),
  )
}

// Capture the URL fragment immediately at module-load time.  In React,
// children’s effects fire before their parents’ effects.  App (a child of
// AuthProvider) has a URL-sync effect that calls
//   window.history.replaceState(null, "", window.location.pathname)
// on mount, which strips the hash *before* our useEffect can read it.
// By snapshotting the hash here we guarantee we see the original value.
const _initialHash = window.location.hash.replace(/^#/, '')

// True only on the document load that carries a fresh OIDC callback token,
// so `auth.login_succeeded` fires once per OIDC login rather than on every
// mount-time token revalidation.
let _oidcLoginPending =
  new URLSearchParams(_initialHash).has('oidc_token') &&
  !new URLSearchParams(_initialHash).has('password_setup')

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupToken, setSetupToken] = useState(() =>
    new URLSearchParams(_initialHash).get('password_setup'),
  )
  const [passwordChanged, setPasswordChanged] = useState(false)
  const sessionVersion = useRef(0)
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
    const version = sessionVersion.current
    try {
      const data = await apiFetchUsers()
      if (version !== sessionVersion.current) return
      setUsers(data.map(toUser))
    } catch (err) {
      if (version !== sessionVersion.current) return
      console.error('Failed to load users', err)
      // If we get a 401, clear the entire session
      if (err instanceof Error && err.message.includes('401')) {
        setCurrentUser(null)
        clearUserStorage()
      }
    } finally {
      if (version === sessionVersion.current) setLoading(false)
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
    const passwordSetup = params.get('password_setup')
    if (oidcToken && passwordSetup === null) {
      setToken(oidcToken)
    }
    params.delete('oidc_token')
    if (oidcErr) {
      // Log the raw code for developer debugging; LoginScreen maps the
      // code to a user-facing message.
      console.warn('OIDC callback returned error:', oidcErr)
      params.delete('oidc_error')
    }
    params.delete('password_setup')
    if (oidcToken || oidcErr || passwordSetup !== null) {
      const remaining = params.toString()
      const cleanUrl =
        window.location.pathname + window.location.search + (remaining ? `#${remaining}` : '')
      window.history.replaceState({}, '', cleanUrl)
    }
  }, [])

  const clearOidcError = useCallback(() => {
    setOidcError(null)
  }, [])

  useEffect(() => {
    const captureSetup = () => {
      const params = new URLSearchParams(window.location.hash.slice(1))
      const token = params.get('password_setup')
      if (token === null) return
      params.delete('password_setup')
      params.delete('oidc_token')
      params.delete('oidc_error')
      const remaining = params.toString()
      window.history.replaceState(
        {},
        '',
        window.location.pathname + window.location.search + (remaining ? `#${remaining}` : ''),
      )
      sessionVersion.current += 1
      _oidcLoginPending = false
      clearUserStorage()
      setCurrentUser(null)
      setUsers([])
      setOidcError(null)
      setLoading(false)
      setSetupToken(token)
    }
    window.addEventListener('hashchange', captureSetup)
    return () => window.removeEventListener('hashchange', captureSetup)
  }, [])

  // On mount, validate stored token by calling a protected endpoint.
  // If the token is expired or the DB was recreated, clear session.
  useEffect(() => {
    const version = sessionVersion.current
    if (new URLSearchParams(_initialHash).has('password_setup')) {
      clearUserStorage()
      setLoading(false) // eslint-disable-line react-hooks/set-state-in-effect -- fragment-based session bootstrap
      return
    }
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

    let cachedUser: Partial<User> | null = null
    if (stored) {
      try {
        cachedUser = {
          has_local_password: false,
          must_change_password: false,
          ...JSON.parse(stored),
        }
      } catch {
        clearUserStorage()
        setLoading(false)
        return
      }
    }

    // Validate the token via /auth/me (accessible by any authenticated role)
    fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (version !== sessionVersion.current) return
        if (res.ok) {
          const data = await res.json()
          if (version !== sessionVersion.current) return
          const freshUser = toUser(data)
          // If a different user was previously stored, clear all state
          // to prevent cross-account leakage (shared student browsers).
          if (cachedUser && cachedUser.id !== freshUser.id) clearUserStorage()
          setCurrentUser(freshUser)
          setToken(token)
          persistCachedUser(freshUser)
          if (_oidcLoginPending) {
            _oidcLoginPending = false
            emitEventNow({
              event: 'auth.login_succeeded',
              action: 'login',
              outcome: 'success',
            })
          }
        } else {
          // Token invalid or user no longer exists — clear session
          clearUserStorage()
        }
      })
      .catch(() => {
        if (version !== sessionVersion.current) return
        // Network error — clear session to be safe
        clearUserStorage()
      })
      .finally(() => {
        if (version === sessionVersion.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const requireChange = () =>
      setCurrentUser((user) => (user ? { ...user, must_change_password: true } : user))
    window.addEventListener('hriv:password-change-required', requireChange)
    return () => window.removeEventListener('hriv:password-change-required', requireChange)
  }, [])

  const refreshCurrentUser = useCallback(async () => {
    const user = toUser(await fetchCurrentUser())
    setCurrentUser(user)
    persistCachedUser(user)
  }, [])

  // Load users list when an admin is authenticated
  useEffect(() => {
    if (currentUser?.role === 'admin' && !currentUser.must_change_password) {
      loadUsers() // eslint-disable-line react-hooks/set-state-in-effect -- standard data-fetch trigger on auth state change
    }
  }, [currentUser, loadUsers])

  const establishSession = useCallback((resp: LoginResponse) => {
    sessionVersion.current += 1
    const user = toUser(resp.user)
    // If a different user was previously logged in, clear all stored state
    // to prevent cross-account leakage (common with shared student browsers).
    const prev = localStorage.getItem('hriv_user')
    if (prev) {
      try {
        const prevUser: Partial<User> = {
          has_local_password: false,
          must_change_password: false,
          ...JSON.parse(prev),
        }
        if (prevUser.id !== user.id) {
          clearUserStorage()
        }
      } catch {
        clearUserStorage()
      }
    }
    setToken(resp.access_token)
    setCurrentUser(user)
    persistCachedUser(user)
    emitEventNow({
      event: 'auth.login_succeeded',
      action: 'login',
      outcome: 'success',
    })
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      establishSession(await apiLoginUser(email, password))
    },
    [establishSession],
  )

  const logout = useCallback(() => {
    sessionVersion.current += 1
    emitEventNow({
      event: 'auth.logout_selected',
      action: 'logout',
      outcome: 'success',
    })
    setCurrentUser(null)
    clearUserStorage()
  }, [])

  const addUser = useCallback(
    async (name: string, email: string, role: Role, password: string, programIds?: number[]) => {
      try {
        const data = await apiCreateUser({ name, email, role, password, program_ids: programIds })
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
          clearUserStorage()
        }
      } catch (err) {
        console.error('Failed to delete user', err)
      }
    },
    [currentUser],
  )

  const canManageUsers = currentUser?.role === 'admin'
  const canEditContent = currentUser?.role === 'admin' || currentUser?.role === 'instructor'
  // Staff get a read-only view of the People directory; admins get the
  // full management view (gated by canManageUsers inside the page).
  const canViewPeople = currentUser?.role === 'admin' || currentUser?.role === 'staff'

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
        refreshCurrentUser,
        canManageUsers,
        canEditContent,
        canViewPeople,
        oidcError,
        clearOidcError,
      }}
    >
      {setupToken !== null ? (
        <PasswordSetupScreen
          key={setupToken}
          onSubmit={async (password) => {
            const version = sessionVersion.current
            const response = await redeemPasswordSetup(setupToken, password)
            if (version !== sessionVersion.current) return
            establishSession(response)
            setSetupToken(null)
          }}
          onSignIn={() => {
            setSetupToken(null)
            logout()
          }}
        />
      ) : currentUser?.must_change_password ? (
        <ForcedPasswordChangeScreen
          onSuccess={async () => {
            await refreshCurrentUser()
            setPasswordChanged(true)
          }}
          onSignOut={logout}
        />
      ) : (
        children
      )}
      <Snackbar
        open={passwordChanged}
        autoHideDuration={6000}
        onClose={() => setPasswordChanged(false)}
      >
        <Alert severity="success" onClose={() => setPasswordChanged(false)}>
          Password changed successfully.
        </Alert>
      </Snackbar>
    </AuthContext.Provider>
  )
}
