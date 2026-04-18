import { createContext } from 'react'
import type { User, Role } from './types'

export interface AuthContextValue {
  currentUser: User | null
  users: User[]
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  addUser: (name: string, email: string, role: Role, password: string, programId?: number | null) => void
  deleteUser: (userId: number) => void
  refreshUsers: () => void
  canManageUsers: boolean
  canEditContent: boolean
  // Short, stable error code returned by the backend OIDC callback
  // (via ``#oidc_error=<code>`` in the URL fragment). ``null`` when the
  // last callback succeeded or no callback has run this session.
  oidcError: string | null
  clearOidcError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
