/**
 * Unit tests for the LoginScreen component.
 *
 * Covers:
 * 1. OIDC-disabled: local credential form renders directly (no toggle)
 * 2. OIDC-enabled default view: only OIDC button + "Sign in with a guest account" link
 * 3. Toggle: clicking "Sign in with a guest account" reveals the local form
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

// Control the mobile/desktop breakpoint. Defaults to desktop (false) so the
// existing suite is unchanged; the mobile block opts in via mockReturnValue.
vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))

// LoginScreen reads the OIDC error code from useAuth; stub the hook so
// these tests don't need an AuthProvider wrapper. Individual tests that
// care about the error path override the return value before rendering.
const mockClearOidcError = vi.fn()
vi.mock('../../src/useAuth', () => ({
  useAuth: vi.fn(() => ({
    oidcError: null,
    clearOidcError: mockClearOidcError,
  })),
}))

import { fetchOidcEnabled } from '../../src/api'
import { useAuth } from '../../src/useAuth'
import useMediaQuery from '@mui/material/useMediaQuery'

// ---------------------------------------------------------------------------
// Helpers — use placeholders to find MUI TextFields since MUI required labels
// include a hidden asterisk that breaks exact getByLabelText matching.
// ---------------------------------------------------------------------------

function getUsernameField() {
  return screen.getByPlaceholderText('username@example.ca')
}

function getPasswordField() {
  return screen.getByPlaceholderText('Password')
}

function queryUsernameField() {
  return screen.queryByPlaceholderText('username@example.ca')
}

/** Render with OIDC disabled */
async function renderOidcDisabled(
  props: { onLogin?: () => Promise<void>; announcement?: string } = {},
) {
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
async function renderOidcEnabled(
  props: { onLogin?: () => Promise<void>; announcement?: string } = {},
) {
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
    // Default every test to the desktop breakpoint; the mobile block opts in.
    // (clearAllMocks keeps implementations, so reset explicitly to avoid leaks.)
    vi.mocked(useMediaQuery).mockReturnValue(false)
    // Reset useAuth to its default (no error) between tests so the
    // OIDC error branch is opt-in per test.
    vi.mocked(useAuth).mockReturnValue({
      oidcError: null,
      clearOidcError: mockClearOidcError,
    } as unknown as ReturnType<typeof useAuth>)
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
      expect(screen.queryByText('Sign in with a guest account')).not.toBeInTheDocument()
    })

    it('does not show "Sign in with ..." link in the local form', async () => {
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

    it('shows the "Sign in with a guest account" link', async () => {
      await renderOidcEnabled()
      expect(screen.getByText('Sign in with a guest account')).toBeInTheDocument()
    })

    it('does not show the local credential form', async () => {
      await renderOidcEnabled()
      expect(queryUsernameField()).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()
    })
  })

  // ─── Toggle behaviour ─────────────────────────────────────────────

  describe('toggle between OIDC and local form', () => {
    it('clicking "Sign in with a guest account" reveals the local form', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      await user.click(screen.getByText('Sign in with a guest account'))

      expect(getUsernameField()).toBeInTheDocument()
      expect(getPasswordField()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeInTheDocument()
    })

    it('local form shows "Sign in with BCIT" link to toggle back', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      await user.click(screen.getByText('Sign in with a guest account'))

      expect(screen.getByText('Sign in with BCIT')).toBeInTheDocument()
    })

    it('clicking "Sign in with BCIT" link returns to OIDC view', async () => {
      const user = userEvent.setup()
      await renderOidcEnabled()

      // Toggle to local form
      await user.click(screen.getByText('Sign in with a guest account'))
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

      await user.type(getUsernameField(), 'admin@example.ca')
      await user.type(getPasswordField(), 'secret')
      await user.click(screen.getByRole('button', { name: 'LOGIN' }))

      expect(onLogin).toHaveBeenCalledWith('admin@example.ca', 'secret')
    })

    it('displays an error alert when onLogin rejects', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockRejectedValue(new Error('bad credentials'))
      await renderOidcDisabled({ onLogin })

      await user.type(getUsernameField(), 'admin@example.ca')
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
      await renderOidcDisabled({
        announcement: 'System maintenance tonight',
      })
      expect(screen.getByText('System maintenance tonight')).toBeInTheDocument()
    })

    it('does not render the announcement when not provided', async () => {
      await renderOidcDisabled()
      expect(screen.queryByText('System maintenance tonight')).not.toBeInTheDocument()
    })

    it('places the announcement below the divider and above the form on mobile', async () => {
      vi.mocked(useMediaQuery).mockReturnValue(true)
      await renderOidcDisabled({ announcement: 'System maintenance tonight' })
      const banner = screen.getByText('System maintenance tonight')
      const divider = document.querySelector('.MuiDivider-root')
      const form = document.querySelector('form')
      expect(divider).not.toBeNull()
      const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
      // DOM order must be: divider → banner → form
      expect(divider!.compareDocumentPosition(banner) & FOLLOWING).toBeTruthy()
      expect(banner.compareDocumentPosition(form!) & FOLLOWING).toBeTruthy()
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

  // ─── OIDC error banner ────────────────────────────────────────────

  describe('when the OIDC callback returned an error', () => {
    function renderWithOidcError(code: string | null) {
      vi.mocked(useAuth).mockReturnValue({
        oidcError: code,
        clearOidcError: mockClearOidcError,
      } as unknown as ReturnType<typeof useAuth>)
      vi.mocked(fetchOidcEnabled).mockResolvedValue({ enabled: true })
      return render(<LoginScreen onLogin={vi.fn()} />)
    }

    it('renders a user-facing message for a known error code', async () => {
      renderWithOidcError('subject_mismatch')
      expect(await screen.findByText(/already linked to a different identity/i)).toBeInTheDocument()
    })

    it('falls back to a generic message for an unknown code', async () => {
      renderWithOidcError('some_future_code')
      expect(await screen.findByText(/Sign-in failed\. Please try again\./i)).toBeInTheDocument()
    })

    it('dismisses the banner by calling clearOidcError', async () => {
      const user = userEvent.setup()
      renderWithOidcError('provider_unreachable')
      const closeBtn = await screen.findByRole('button', {
        name: /close/i,
      })
      await user.click(closeBtn)
      expect(mockClearOidcError).toHaveBeenCalledTimes(1)
    })

    it('renders nothing when oidcError is null', async () => {
      renderWithOidcError(null)
      await waitFor(() => {
        expect(fetchOidcEnabled).toHaveBeenCalled()
      })
      expect(screen.queryByText(/already linked to a different identity/i)).not.toBeInTheDocument()
    })
  })

  // ─── Mobile (small form factor) layout ─────────────────────────────
  describe('mobile layout', () => {
    async function renderMobileOidcDisabled() {
      vi.mocked(useMediaQuery).mockReturnValue(true)
      return renderOidcDisabled()
    }

    it('shows the theme toggle on desktop', async () => {
      await renderOidcDisabled() // desktop (default breakpoint)
      expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument()
    })

    it('hides the theme toggle on mobile (relocated to the profile menu post-auth)', async () => {
      await renderMobileOidcDisabled()
      expect(screen.queryByRole('button', { name: /toggle theme/i })).not.toBeInTheDocument()
    })

    it('renders a divider under the brand lockup on mobile', async () => {
      await renderMobileOidcDisabled()
      expect(screen.getByRole('separator')).toBeInTheDocument()
    })

    it('drops "(HRIV)" and "Login" from the brand heading on mobile', async () => {
      await renderMobileOidcDisabled()
      // Heading (h5) is unique by role; footer shares the plain text.
      expect(
        screen.getByRole('heading', { name: 'High Resolution Image Viewer' }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/\(HRIV\)/)).not.toBeInTheDocument()
    })

    it('renders outlined (bordered, rounded) credential fields on mobile', async () => {
      await renderMobileOidcDisabled()
      expect(getUsernameField().closest('.MuiOutlinedInput-root')).not.toBeNull()
      expect(getPasswordField().closest('.MuiOutlinedInput-root')).not.toBeNull()
    })

    it('renders field labels as standalone <label>s above the inputs on mobile', async () => {
      await renderMobileOidcDisabled()
      const usernameLabel = screen.getByText('Username *')
      expect(usernameLabel.tagName).toBe('LABEL')
      expect(usernameLabel).toHaveAttribute('for', 'login-username')
      const passwordLabel = screen.getByText('Password *')
      expect(passwordLabel.tagName).toBe('LABEL')
      expect(passwordLabel).toHaveAttribute('for', 'login-password')
    })
  })
})
