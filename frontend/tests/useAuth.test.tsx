import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthContext } from '../src/authContextValue'
import type { AuthContextValue } from '../src/authContextValue'
import { useAuth } from '../src/useAuth'

const mockValue: AuthContextValue = {
  currentUser: null,
  users: [],
  loading: false,
  login: async () => {},
  logout: () => {},
  addUser: () => {},
  deleteUser: () => {},
  refreshUsers: () => {},
  canManageUsers: false,
  canEditContent: false,
  oidcError: null,
  clearOidcError: () => {},
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={mockValue}>
      {children}
    </AuthContext.Provider>
  )
}

describe('useAuth', () => {
  it('returns the auth context value when inside a provider', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current).toBe(mockValue)
  })

  it('throws when used outside an AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth())
    }).toThrow('useAuth must be used within AuthProvider')
  })
})
