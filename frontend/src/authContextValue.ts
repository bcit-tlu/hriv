import { createContext } from 'react'
import type { User, Role } from './types'

export interface AuthContextValue {
  currentUser: User | null
  users: User[]
  login: (userId: string) => void
  logout: () => void
  addUser: (name: string, email: string, role: Role) => void
  deleteUser: (userId: string) => void
  canManageUsers: boolean
  canEditContent: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
