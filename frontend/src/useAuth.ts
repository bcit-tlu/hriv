import { useContext } from 'react'
import { AuthContext } from './authContextValue'
import type { AuthContextValue } from './authContextValue'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
