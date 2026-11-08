import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChangePasswordDialog from '../../src/components/ChangePasswordDialog'

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
    [
      401,
      'Invalid or expired token',
      'Your session has expired or is invalid. Please sign in again.',
    ],
    [401, 'Not authenticated', 'Please sign in again'],
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
