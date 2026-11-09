import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ForcedPasswordChangeScreen } from '../../src/components/ChangePasswordDialog'

afterEach(cleanup)

describe('ForcedPasswordChangeScreen', () => {
  it('explains the requirement and permits sign out without application navigation', () => {
    const onSignOut = vi.fn()
    render(<ForcedPasswordChangeScreen onSuccess={vi.fn()} onSignOut={onSignOut} />)
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.getByText(/Your administrator requires a password change/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
