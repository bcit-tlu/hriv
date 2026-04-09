/**
 * Unit tests for the LoginScreen component.
 *
 * Covers:
 * 1. OIDC-disabled: local credential form renders directly (no toggle)
 * 2. OIDC-enabled default view: only OIDC button + "Use a local user" link
 * 3. Toggle: clicking "Use a local user" reveals the local form
 * 4. Toggle back: clicking "Sign in with BCIT" returns to OIDC view
 * 5. Local form submission calls onLogin with email & password
 * 6. Login error displays an alert
 * 7. Announcement banner renders when provided
 * 8. Forgot Password dialog opens on button click
 * 9. Graceful fallback when fetchOidcEnabled fails
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginScreen from '../../src/components/LoginScreen'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api', () => ({
  fetchOidcEnabled: vi.fn(),
  getOidcLoginUrl: vi.fn(() => '/api/auth/oidc/login'),
}))

import { fetchOidcEnabled } from '../../src/api'

// ---------------------------------------------------------------------------
// Helpers — use placeholders to find MUI TextFields since MUI required labels
// include a hidden asterisk that breaks exact getByLabelText matching.
// ---------------------------------------------------------------------------

function getUsernameField() {
  return screen.getByPlaceholderText('username@bcit.ca')
}

function getPasswordField() {
  return screen.getByPlaceholderText('Password')
}

function queryUsernameField() {
  return screen.queryByPlaceholderText('username@bcit.ca')
}

/** Render with OIDC disabled */
async function renderOidcDisabled(props: { onLogin?: () => Promise<void>; announcement?: string } = {}) {
  const onLogin = props.onLogin ?? vi.fn()
  vi.mocked(fetchOidcEnabled).mockResolvedValue({ enabled: false })
  const result = render(<LoginScreen onLogin={onLogin} announcement={props.announcement} />)
  // Wait for the useEffect that calls fetchOidcEnabled to settle
  await waitFor(() => {
    expect(fetchOidcEnabled).toHaveBeenCalled()
  })
  return { ...result, onLogin }
}

/** Helper: render with OIDC enabled */
async function renderOidcEnabled(props: { onLogin?: () => Promise<void>; announcement?: string } = {}) {
  const onLogin = props.onLogin ?? vi.fn()
  vi.mocked(fetchOidcEnabled).mockResolvedValue({ enabled: true })
  const result = render(<LoginScreen onLogin={onLogin} announcement={props.announcement} />)
  await waitFor(() => {
    expect(fetchOidcEnabled).toHaveBeenCalled()
  })
  return { ...result, onLogin }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── OIDC disabled ─────────────────────────────────────────────────

  describe('when OIDC is disabled', () => {
    it('renders the local credential form directly', async () => {
      await renderOidcDisabled()
      expect(getUsernameField()).toBeInTheDocument()
      expect(getPasswordField()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeInTheDocument()
    })

    it('does not show the OIDC button or toggle links', async () => {
      await renderOidcDisabled()
      expect(screen.queryByRole('button', { name: /Sign in with BCIT/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Use a local user')).not.toBeInTheDocument()
    })

    it('does not show "Sign in with BCIT" link in the local form', async () => {
      await renderOidcDisabled()
      expect(screen.queryByRole('button', { name: /Sign in with BCIT/i })).not.toBeInTheDocument()
    })
  })

  // ─── OIDC enabled — default view ──────────────────────────────────

  describe('when OIDC is enabled (default view)', () => {
    it('shows the OIDC button', async () => {
      await renderOidcEnabled()
      expect(screen.getByRole('button', { name: /Sign in with BCIT/i })).toBeInTheDocument()
    })

    it('shows the "Use a local user" link', async () => {
      await renderOidcEnabled()
      expect(screen.getByText('Use a local user')).toBeInTheDocument()
    })

    it('does not show the local credential form', async () => {
      await renderOidcEnabled()
      expect(queryUsernameField()).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()
    })
  })

  // ─── Toggle behaviour ─────────────────────────────────────────────

  describe('toggle between OIDC and local form', () => {
    it('clicking "Use a local user" reveals the local form', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      await user.click(screen.getByText('Use a local user'))

      expect(getUsernameField()).toBeInTheDocument()
      expect(getPasswordField()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeInTheDocument()
    })

    it('local form shows "Sign in with BCIT" link to toggle back', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      await user.click(screen.getByText('Use a local user'))

      expect(screen.getByText('Sign in with BCIT')).toBeInTheDocument()
    })

    it('clicking "Sign in with BCIT" link returns to OIDC view', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      // Toggle to local form
      await user.click(screen.getByText('Use a local user'))
      expect(getUsernameField()).toBeInTheDocument()

      // Toggle back to OIDC view
      await user.click(screen.getByText('Sign in with BCIT'))
      expect(queryUsernameField()).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Sign in with BCIT/i })).toBeInTheDocument()
    })
  })

  // ─── Local form submission ────────────────────────────────────────

  describe('local form submission', () => {
    it('calls onLogin with email and password on submit', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockResolvedValue(undefined)
      await renderOidcDisabled({ onLogin })

      await user.type(getUsernameField(), 'admin@bcit.ca')
      await user.type(getPasswordField(), 'secret')
      await user.click(screen.getByRole('button', { name: 'LOGIN' }))

      expect(onLogin).toHaveBeenCalledWith('admin@bcit.ca', 'secret')
    })

    it('displays an error alert when onLogin rejects', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockRejectedValue(new Error('bad credentials'))
      await renderOidcDisabled({ onLogin })

      await user.type(getUsernameField(), 'admin@bcit.ca')
      await user.type(getPasswordField(), 'wrong')
      await user.click(screen.getByRole('button', { name: 'LOGIN' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect email or password')).toBeInTheDocument()
      })
    })

    it('disables the LOGIN button when fields are empty', async () => {
      await renderOidcDisabled()
      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeDisabled()
    })
  })

  // ─── Announcement banner ──────────────────────────────────────────

  describe('announcement banner', () => {
    it('renders the announcement when provided', async () => {
      await renderOidcDisabled({ announcement: 'System maintenance tonight' })
      expect(screen.getByText('System maintenance tonight')).toBeInTheDocument()
    })

    it('does not render the announcement when not provided', async () => {
      await renderOidcDisabled()
      expect(screen.queryByText('System maintenance tonight')).not.toBeInTheDocument()
    })
  })

  // ─── Forgot Password dialog ───────────────────────────────────────

  describe('forgot password dialog', () => {
    it('opens the dialog when "Forgot Password?" is clicked', async () => {
      const user = userEvent.setup()
      await renderOidcDisabled()

      await user.click(screen.getByRole('button', { name: /Forgot Password/i }))

      await waitFor(() => {
        expect(screen.getByText(/contact the TLU Lab via Teams/i)).toBeInTheDocument()
      })
    })
  })

  // ─── fetchOidcEnabled failure ─────────────────────────────────────

  describe('when fetchOidcEnabled fails', () => {
    it('falls back to showing the local form (OIDC disabled)', async () => {
      vi.mocked(fetchOidcEnabled).mockRejectedValue(new Error('network'))
      render(<LoginScreen onLogin={vi.fn()} />)

      await waitFor(() => {
        expect(fetchOidcEnabled).toHaveBeenCalled()
      })

      // After the fetch fails, oidcEnabled stays false so the local form renders
      await waitFor(() => {
        expect(getUsernameField()).toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: /Sign in with BCIT/i })).not.toBeInTheDocument()
    })
  })
})
