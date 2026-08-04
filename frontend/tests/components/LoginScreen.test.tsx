/**
 * Unit tests for the LoginScreen component.
 *
 * The sign-in landing ("Sign in with BCIT" + "Use a local user") is ALWAYS the
 * entry point — it is not gated on whether the backend reports OIDC as
 * configured. The local credential form is opt-in via "Use a local user", and
 * there are two routes back: the mobile-only back arrow, and the
 * "Sign in with BCIT" link (the only route on desktop).
 *
 * Covers:
 * 1. Landing renders on load, on both desktop and mobile
 * 2. Opting into the local form, plus both routes back to the landing
 * 3. Mobile back arrow — present on the form, absent on the landing/desktop
 * 4. Mobile design details: brand header, "Local Account", external labels
 * 5. Local form submission, error alert, disabled LOGIN button
 * 6. Announcement banner — visible by default, dismissible
 * 7. Forgot Password dialog
 * 8. OIDC callback error banner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useMediaQuery from '@mui/material/useMediaQuery'
import LoginScreen from '../../src/components/LoginScreen'

// The mobile layout is gated on useMediaQuery(down('sm')). Default to false so
// the suite exercises the desktop layout; the mobile block flips it.
vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api', () => ({
  getOidcLoginUrl: vi.fn(() => '/api/auth/oidc/login'),
}))

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

import { useAuth } from '../../src/useAuth'

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

const BACK_LABEL = 'Back to sign-in options'

interface RenderProps {
  onLogin?: () => Promise<void>
  announcement?: string
  onDismissAnnouncement?: () => void
}

function renderScreen(props: RenderProps = {}) {
  const onLogin = props.onLogin ?? vi.fn()
  const result = render(
    <LoginScreen
      onLogin={onLogin}
      announcement={props.announcement}
      onDismissAnnouncement={props.onDismissAnnouncement}
    />,
  )
  return { ...result, onLogin }
}

/** Opt into the local credential form from the landing. */
async function openLocalForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /use a local user/i }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset useAuth to its default (no error) between tests so the
    // OIDC error branch is opt-in per test.
    vi.mocked(useAuth).mockReturnValue({
      oidcError: null,
      clearOidcError: mockClearOidcError,
    } as unknown as ReturnType<typeof useAuth>)
  })

  // ─── Landing ───────────────────────────────────────────────────────

  describe('sign-in landing (default view)', () => {
    it('renders the two sign-in options on load', () => {
      renderScreen()
      expect(screen.getByRole('button', { name: /sign in with bcit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /use a local user/i })).toBeInTheDocument()
    })

    it('does not render the local credential form until opted into', () => {
      renderScreen()
      expect(queryUsernameField()).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'LOGIN' })).not.toBeInTheDocument()
    })

    it('is the entry point on mobile as well', () => {
      mockUseMediaQuery.mockReturnValue(true)
      renderScreen()
      expect(screen.getByRole('button', { name: /sign in with bcit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /use a local user/i })).toBeInTheDocument()
      expect(queryUsernameField()).not.toBeInTheDocument()
      mockUseMediaQuery.mockReturnValue(false)
    })
  })

  // ─── Opting into the local form, and back again ────────────────────

  describe('opting into the local account form', () => {
    it('reveals the credential form', async () => {
      const user = userEvent.setup()
      renderScreen()

      await openLocalForm(user)

      expect(getUsernameField()).toBeInTheDocument()
      expect(getPasswordField()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeInTheDocument()
      // The landing's primary button is replaced by the form.
      expect(screen.queryByRole('button', { name: /use a local user/i })).not.toBeInTheDocument()
    })

    it('offers a "Sign in with BCIT" link back to the landing', async () => {
      const user = userEvent.setup()
      renderScreen()

      await openLocalForm(user)
      expect(screen.getByText('Sign in with BCIT')).toBeInTheDocument()

      await user.click(screen.getByText('Sign in with BCIT'))

      expect(queryUsernameField()).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /use a local user/i })).toBeInTheDocument()
    })
  })

  // ─── Local form submission ────────────────────────────────────────

  describe('local form submission', () => {
    it('calls onLogin with email and password on submit', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockResolvedValue(undefined)
      renderScreen({ onLogin })
      await openLocalForm(user)

      await user.type(getUsernameField(), 'admin@example.ca')
      await user.type(getPasswordField(), 'secret')
      await user.click(screen.getByRole('button', { name: 'LOGIN' }))

      expect(onLogin).toHaveBeenCalledWith('admin@example.ca', 'secret')
    })

    it('displays an error alert when onLogin rejects', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockRejectedValue(new Error('bad credentials'))
      renderScreen({ onLogin })
      await openLocalForm(user)

      await user.type(getUsernameField(), 'admin@example.ca')
      await user.type(getPasswordField(), 'wrong')
      await user.click(screen.getByRole('button', { name: 'LOGIN' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect email or password')).toBeInTheDocument()
      })
    })

    it('disables the LOGIN button when fields are empty', async () => {
      const user = userEvent.setup()
      renderScreen()
      await openLocalForm(user)

      expect(screen.getByRole('button', { name: 'LOGIN' })).toBeDisabled()
    })
  })

  // ─── Announcement banner ──────────────────────────────────────────

  describe('announcement banner', () => {
    it('renders the announcement when provided', () => {
      renderScreen({ announcement: 'System maintenance tonight' })
      expect(screen.getByText('System maintenance tonight')).toBeInTheDocument()
    })

    it('does not render the announcement when not provided', () => {
      renderScreen()
      expect(screen.queryByText('System maintenance tonight')).not.toBeInTheDocument()
    })
  })

  // ─── Forgot Password dialog ───────────────────────────────────────

  describe('forgot password dialog', () => {
    it('opens the dialog when "Forgot Password?" is clicked', async () => {
      const user = userEvent.setup()
      renderScreen()
      await openLocalForm(user)

      await user.click(screen.getByRole('button', { name: /Forgot Password/i }))

      await waitFor(() => {
        expect(screen.getByText(/contact the TLU Lab via Teams/i)).toBeInTheDocument()
      })
    })
  })

  // ─── OIDC error banner ────────────────────────────────────────────

  describe('when the OIDC callback returned an error', () => {
    function renderWithOidcError(code: string | null) {
      vi.mocked(useAuth).mockReturnValue({
        oidcError: code,
        clearOidcError: mockClearOidcError,
      } as unknown as ReturnType<typeof useAuth>)
      return renderScreen()
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
      await user.click(await screen.findByRole('button', { name: /close/i }))
      expect(mockClearOidcError).toHaveBeenCalledTimes(1)
    })

    it('renders nothing when oidcError is null', () => {
      renderWithOidcError(null)
      expect(screen.queryByText(/already linked to a different identity/i)).not.toBeInTheDocument()
    })
  })

  // ─── Desktop specifics ────────────────────────────────────────────

  describe('desktop layout', () => {
    it('shows the BCIT heading and no mobile back arrow', async () => {
      const user = userEvent.setup()
      renderScreen()

      expect(screen.getByText(/High Resolution Image Viewer \(HRIV\) Login/i)).toBeInTheDocument()

      await openLocalForm(user)
      // Desktop relies on the "Sign in with BCIT" link instead of an arrow.
      expect(screen.queryByRole('button', { name: BACK_LABEL })).not.toBeInTheDocument()
      expect(screen.getByText('Sign in with BCIT')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Mobile layout (design): brand header, "Local Account" heading, labels
  // rendered *above* the fields rather than as MUI floating labels, and the
  // top-left back arrow.
  // -------------------------------------------------------------------------
  describe('mobile layout', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })
    afterEach(() => {
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('shows the HRIV brand header instead of the desktop BCIT heading', () => {
      renderScreen()

      expect(screen.getByText('HRIV')).toBeInTheDocument()
      expect(
        screen.queryByText(/High Resolution Image Viewer \(HRIV\) Login/i),
      ).not.toBeInTheDocument()
    })

    it('labels the local form with a "Local Account" heading', async () => {
      const user = userEvent.setup()
      renderScreen()
      await openLocalForm(user)

      expect(screen.getByText('Local Account')).toBeInTheDocument()
    })

    it('renders external field labels wired to their inputs', async () => {
      const user = userEvent.setup()
      renderScreen()
      await openLocalForm(user)

      // The visible label text carries the asterisk, and htmlFor/id keep it
      // associated with the input so it stays accessible.
      expect(screen.getByText('Username *')).toBeInTheDocument()
      expect(screen.getByText('Password *')).toBeInTheDocument()
      expect(getUsernameField()).toHaveAttribute('id', 'login-username')
      expect(getPasswordField()).toHaveAttribute('id', 'login-password')
    })

    it('still submits the credentials', async () => {
      const user = userEvent.setup()
      const onLogin = vi.fn().mockResolvedValue(undefined)
      renderScreen({ onLogin })
      await openLocalForm(user)

      await user.type(getUsernameField(), 'stu@bcit.ca')
      await user.type(getPasswordField(), 'secret')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(onLogin).toHaveBeenCalledWith('stu@bcit.ca', 'secret')
      })
    })

    it('shows the announcement strip by default and lets the user close it', async () => {
      const user = userEvent.setup()
      const onDismissAnnouncement = vi.fn()
      renderScreen({
        announcement: 'ZIP uploads are here',
        onDismissAnnouncement,
      })

      // Visible without any user action…
      expect(screen.getByText("What's New")).toBeInTheDocument()
      expect(screen.getByText('ZIP uploads are here')).toBeInTheDocument()

      // …and closable.
      await user.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismissAnnouncement).toHaveBeenCalledTimes(1)
    })

    it('omits the dismiss control when no handler is supplied', () => {
      renderScreen({ announcement: 'Read only notice' })

      expect(screen.getByText('Read only notice')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    })

    it('stays visible while navigating to the local form and back', async () => {
      // Closing it is the ONLY thing that hides the banner — moving between the
      // landing and the credential form must not drop it.
      const user = userEvent.setup()
      renderScreen({
        announcement: 'Persistent notice',
        onDismissAnnouncement: vi.fn(),
      })

      expect(screen.getByText('Persistent notice')).toBeInTheDocument()

      await openLocalForm(user)
      expect(screen.getByText('Persistent notice')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: BACK_LABEL }))
      expect(screen.getByText('Persistent notice')).toBeInTheDocument()
    })

    it('has no back arrow on the landing — there is nowhere to go back to', () => {
      renderScreen()
      expect(screen.queryByRole('button', { name: BACK_LABEL })).not.toBeInTheDocument()
    })

    it('offers a back arrow from the local form to the landing', async () => {
      const user = userEvent.setup()
      renderScreen()

      await openLocalForm(user)
      expect(screen.getByText('Local Account')).toBeInTheDocument()

      // The arrow appears on the form…
      const back = screen.getByRole('button', { name: BACK_LABEL })
      expect(back).toBeInTheDocument()

      // …and returns to the landing, where it disappears again.
      await user.click(back)

      expect(screen.getByRole('button', { name: /use a local user/i })).toBeInTheDocument()
      expect(screen.queryByText('Local Account')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: BACK_LABEL })).not.toBeInTheDocument()
    })
  })
})
