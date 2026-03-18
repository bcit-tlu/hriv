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

  // On mount, validate stored token by calling a protected endpoint.
  // If the token is expired or the DB was recreated, clear session.
  useEffect(() => {
    const stored = localStorage.getItem('corgi_user')
    const token = getToken()
    if (!token || !stored) {
      setLoading(false)
      return
    }

    try {
      JSON.parse(stored)
    } catch {
      setToken(null)
      localStorage.removeItem('corgi_user')
      setLoading(false)
      return
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
          localStorage.setItem('corgi_user', JSON.stringify(freshUser))
        } else {
          // Token invalid or user no longer exists — clear session
          setToken(null)
          localStorage.removeItem('corgi_user')
        }
      })
      .catch(() => {
        // Network error — clear session to be safe
        setToken(null)
        localStorage.removeItem('corgi_user')
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
      localStorage.setItem('corgi_user', JSON.stringify(user))
    },
    [],
  )

  const logout = useCallback(() => {
    setCurrentUser(null)
    setToken(null)
    localStorage.removeItem('corgi_user')
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
          localStorage.removeItem('corgi_user')
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
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
