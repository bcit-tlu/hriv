import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PasswordSetupScreen from '../../src/components/PasswordSetupScreen'
import ChangePasswordDialog from '../../src/components/ChangePasswordDialog'
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

describe('ChangePasswordDialog', () => {
  it('validates fields and completes a password change', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    render(<ChangePasswordDialog open onSuccess={onSuccess} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Current password/), {
      target: { value: 'old-password' },
    })
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/change-password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ current_password: 'old-password', new_password: 'new-password' }),
      }),
    )
  })
  it.each([
    [401, 'Invalid current password', 'current password is incorrect'],
    [429, 'rate_limited', 'Too many attempts'],
    [422, 'password_unchanged', 'different password'],
    [403, 'oidc_linked', 'identity provider'],
  ])('renders change error %s', async (status, detail, message) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ detail }), { status: status as number })),
    )
    const onSuccess = vi.fn()
    render(<ChangePasswordDialog open onSuccess={onSuccess} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/^Current password/), {
      target: { value: 'old-password' },
    })
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message as string)
    expect(onSuccess).not.toHaveBeenCalled()
  })
  it('retries a failed session refresh without resubmitting the password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    render(<ChangePasswordDialog open onSuccess={onSuccess} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/^Current password/), {
      target: { value: 'old-password' },
    })
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('session could not be refreshed')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
