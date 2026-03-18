import { createContext } from 'react'
import type { User, Role } from './types'

export interface AuthContextValue {
  currentUser: User | null
  users: User[]
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  addUser: (name: string, email: string, role: Role, password: string, program?: string) => void
  deleteUser: (userId: number) => void
  refreshUsers: () => void
  canManageUsers: boolean
  canEditContent: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
