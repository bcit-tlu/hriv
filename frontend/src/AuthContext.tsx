import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User, Role } from './types'
import { AuthContext } from './authContextValue'

const SEED_USERS = [
  { id: 'u-admin', name: 'Alice Admin', email: 'alice@example.com', role: 'admin' as const },
  { id: 'u-instructor', name: 'Bob Instructor', email: 'bob@example.com', role: 'instructor' as const },
  { id: 'u-student', name: 'Charlie Student', email: 'charlie@example.com', role: 'student' as const },
]

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>(SEED_USERS)
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  const login = useCallback(
    (userId: string) => {
      const user = users.find((u) => u.id === userId) ?? null
      setCurrentUser(user)
    },
    [users],
  )

  const logout = useCallback(() => {
    setCurrentUser(null)
  }, [])

  const addUser = useCallback((name: string, email: string, role: Role) => {
    const newUser: User = {
      id: `u-${Date.now()}`,
      name,
      email,
      role,
    }
    setUsers((prev) => [...prev, newUser])
  }, [])

  const deleteUser = useCallback(
    (userId: string) => {
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      if (currentUser?.id === userId) {
        setCurrentUser(null)
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
        login,
        logout,
        addUser,
        deleteUser,
        canManageUsers,
        canEditContent,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
