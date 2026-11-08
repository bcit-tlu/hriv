import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PasswordSetupScreen from '../../src/components/PasswordSetupScreen'
import { ApiError } from '../../src/api'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fillPasswords() {
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new-password' } })
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
    target: { value: 'new-password' },
  })
}

describe('PasswordSetupScreen', () => {
  it('validates confirmation, submits once and blocks duplicate submissions', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {}))
    render(<PasswordSetupScreen onSubmit={onSubmit} onSignIn={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
    fillPasswords()
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: 'mismatch' },
    })
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('new-password')
    expect(screen.getByRole('button', { name: 'Setting password…' })).toBeDisabled()
  })
  it.each([
    [401, 'invalid_token', 'This link has expired'],
    [403, 'account_inactive', 'Account has been disabled'],
    [409, 'password_already_set', 'A password is already set'],
    [429, 'rate_limited', 'Too many attempts'],
    [422, 'validation', 'Use a password with at least 8'],
  ])('renders setup error %s', async (status, detail, message) => {
    const onSignIn = vi.fn()
    render(
      <PasswordSetupScreen
        onSubmit={vi.fn().mockRejectedValue(new ApiError(status as number, detail as string))}
        onSignIn={onSignIn}
      />,
    )
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message as string)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }))
    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
