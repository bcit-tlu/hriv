import { useState, useEffect } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import CloseIcon from '@mui/icons-material/Close'
import ColorModeToggle from './ColorModeToggle'
import { fetchOidcEnabled, getOidcLoginUrl } from '../api'
import { useAuth } from '../useAuth'
import FooterBar from './FooterBar'

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>
}

// Map short, stable error codes returned by the backend OIDC callback
// to user-facing messages. Keep the set in sync with the constants in
// ``backend/app/routers/oidc.py``. Unknown codes fall through to a
// generic message so a future backend addition never leaves the user
// with a blank alert.
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  client_misconfigured: 'Single sign-on is misconfigured. Please contact an administrator.',
  provider_unreachable:
    'The identity provider is currently unreachable. Please try again in a moment.',
  token_exchange_failed:
    "We couldn't complete sign-in with the identity provider. Please try again.",
  userinfo_failed: "We couldn't read your profile from the identity provider. Please try again.",
  missing_claims:
    'Your account is missing required information from the identity provider. Please contact an administrator.',
  subject_mismatch:
    'This email is already linked to a different identity. Please contact an administrator.',
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [showLocalForm, setShowLocalForm] = useState(false)
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const { oidcError, clearOidcError } = useAuth()

  // All login-page tweaks in this block are phone-only (small form factor);
  // the desktop layout is intentionally left unchanged.
  const theme = useTheme()
  // `noSsr: true` evaluates the query synchronously in a layout effect before
  // first paint, so phones don't briefly flash the desktop layout on initial
  // render. Safe here because this is a client-only (Vite SPA) app.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })

  // Mobile-only field treatment: rounded, surface-filled inputs with the
  // thinnest possible outline (1px in every state — default, hover, and focus,
  // so focus never thickens it). All values are theme tokens, so light/dark
  // modes stay in sync — no hard-coded colours.
  const mobileFieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: 2,
      bgcolor: 'background.default',
    },
    // Larger typed-in text (and placeholder) for easier reading on mobile.
    '& .MuiOutlinedInput-input': {
      fontSize: 17,
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: 'divider',
      borderWidth: '1px',
    },
    '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'divider',
      borderWidth: '1px',
    },
    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderWidth: '1px',
    },
  }

  // Field label rendered ABOVE the input on mobile (not MUI's floating notch
  // label). 14px matches the mobile body scale (per user request to enlarge the
  // labels); secondary colour mirrors the previous label look.
  const mobileFieldLabelSx = {
    display: 'block',
    mb: 0.5,
    fontSize: 14,
    color: 'text.secondary',
  }

  // Desktop keeps MUI's standard (underline) fields with the floating notch
  // label, but adopts the same font scale as mobile: 14px labels and 17px
  // typed-in text. Applies to the standard-variant class names.
  const desktopFieldSx = {
    '& .MuiInputBase-input': {
      fontSize: 17,
    },
    '& .MuiInputLabel-root': {
      fontSize: 14,
    },
  }

  useEffect(() => {
    fetchOidcEnabled()
      .then((res) => setOidcEnabled(res.enabled))
      .catch(() => setOidcEnabled(false))
  }, [])

  const oidcErrorMessage = oidcError
    ? (OIDC_ERROR_MESSAGES[oidcError] ?? 'Sign-in failed. Please try again.')
    : null

  const handleOidcLogin = () => {
    window.location.href = getOidcLoginUrl()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      console.error('Login error:', err instanceof Error ? err.message : err)
      setError('Incorrect email or password')
    } finally {
      setLoading(false)
    }
  }

  // When OIDC is enabled and the local form is not toggled, show only the
  // OIDC button + a "Sign in with a guest account" link (Rancher-style).
  const showOidcDefault = oidcEnabled && !showLocalForm

  return (
    <Box
      sx={{
        // Mobile: `100dvh` (dynamic viewport height) sizes the page to the
        // *visible* viewport so the footer isn't pushed under the browser
        // chrome — `100vh` targets the largest (address-bar-hidden) viewport
        // and forces a scroll on phones. Desktop keeps `100vh`.
        minHeight: isMobile ? '100dvh' : '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Theme toggle (Light / Dark / Auto). Hidden on mobile — after sign-in
            the toggle lives in the profile menu (AppShell), so the small-screen
            login stays uncluttered. Desktop keeps it here. */}
        {!isMobile && (
          <Box
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 1,
            }}
          >
            <ColorModeToggle iconButtonSx={{ color: 'text.secondary' }} />
          </Box>
        )}

        {/* Left side — form. `xs: '1 1 100%'` makes this column fill the whole
            viewport on mobile (without it the flex item shrink-wraps to its
            content and hugs the left). Tighter mobile padding for a fuller
            edge-to-edge feel. */}
        <Box
          sx={{
            flex: { xs: '1 1 100%', md: '0 0 50%' },
            display: 'flex',
            // Mobile: anchor content to the top (with breathing room) instead of
            // vertically centring it — reads better on phone browsers. Desktop
            // keeps the centred layout.
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'center',
            px: { xs: 2, sm: 6, md: 8 },
            // Mobile: modest top padding (was 6) so the full page — brand,
            // form and footer — fits the viewport without vertical scrolling.
            ...(isMobile && { pt: 3 }),
          }}
        >
          {/* On mobile the content spans the full column (no 400px cap). */}
          <Box sx={{ width: '100%', maxWidth: isMobile ? 'none' : 400 }}>
            {/* BCIT logo + heading. Mobile: an enlarged logo stacked ON TOP of a
                single-line title; desktop keeps the original inline row. */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                // Mobile: centre the stacked logo + title.
                alignItems: 'center',
                // Mobile: more space below the (stacked) logo; desktop keeps the
                // tight inline gap.
                gap: isMobile ? 3 : 1.5,
                // Mobile: tighter space below the brand (down to the divider).
                mb: isMobile ? 3 : 5,
              }}
            >
              <Box
                component="img"
                src="/bcit-logo.svg"
                alt="BCIT"
                sx={{ height: isMobile ? 64 : 48 }}
              />
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 400,
                  // Mobile: larger + bold, centered. Allowed to wrap (no nowrap) so
                  // the long title never overflows horizontally on ~320px-wide
                  // phones — it stays on one line where it fits and wraps only on
                  // the very narrowest screens.
                  ...(isMobile && { fontSize: 21, fontWeight: 700, textAlign: 'center' }),
                }}
              >
                {isMobile
                  ? 'High Resolution Image Viewer'
                  : 'High Resolution Image Viewer (HRIV) Login'}
              </Typography>
            </Box>

            {/* A divider visually separates the brand lockup from the credential
                form, with generous space above (brand-box mb) and below
                (divider mb). Shown on both mobile and desktop. */}
            {/* Mobile only: scaleY(0.5) renders the 1px line as a ~0.5px hairline
                on hi-DPI phone screens — the thinnest a divider can practically
                get. The mb (spacing) is unaffected by the transform. */}
            <Divider sx={{ mb: 3, ...(isMobile && { transform: 'scaleY(0.5)' }) }} />

            {/* Section heading introducing the credential form below. */}
            <Typography
              component="h2"
              sx={{
                mb: 3,
                textAlign: 'center',
                fontWeight: 700,
                fontSize: '1.25rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                // Match the brand title, which uses the default primary text
                // color so it tracks the active theme (light/dark).
                color: 'text.primary',
              }}
            >
              Log In
            </Typography>

            {oidcErrorMessage && (
              <Alert severity="error" onClose={clearOidcError} sx={{ mb: 2 }}>
                {oidcErrorMessage}
              </Alert>
            )}

            {showOidcDefault ? (
              /* ── OIDC-primary view ─────────────────── */
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleOidcLogin}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    py: 1.25,
                    fontSize: '0.95rem',
                  }}
                >
                  Sign in with BCIT
                </Button>
                <Link
                  component="button"
                  variant="body2"
                  underline="hover"
                  onClick={() => setShowLocalForm(true)}
                >
                  Sign in with a guest account
                </Link>
              </Box>
            ) : (
              /* ── Local-credentials view ────────────── */
              <Box
                component="form"
                onSubmit={handleSubmit}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                {error && (
                  <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                  </Alert>
                )}

                <Box>
                  {isMobile && (
                    <Typography
                      variant="caption"
                      component="label"
                      htmlFor="login-username"
                      sx={mobileFieldLabelSx}
                    >
                      {/* Asterisk is decorative: aria-hidden so the accessible
                          name stays "Username"; the required state is conveyed
                          by the input's `required` attribute (MUI desktop
                          parity). */}
                      Username{' '}
                      <Box component="span" aria-hidden="true">
                        *
                      </Box>
                    </Typography>
                  )}
                  <TextField
                    id="login-username"
                    label={isMobile ? undefined : 'Username'}
                    placeholder="username@example.ca"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    fullWidth
                    autoFocus
                    autoComplete="email"
                    variant={isMobile ? 'outlined' : 'standard'}
                    sx={isMobile ? mobileFieldSx : desktopFieldSx}
                  />
                </Box>

                <Box>
                  {isMobile && (
                    <Typography
                      variant="caption"
                      component="label"
                      htmlFor="login-password"
                      sx={mobileFieldLabelSx}
                    >
                      {/* See the username label above re: aria-hidden asterisk. */}
                      Password{' '}
                      <Box component="span" aria-hidden="true">
                        *
                      </Box>
                    </Typography>
                  )}
                  <TextField
                    id="login-password"
                    label={isMobile ? undefined : 'Password'}
                    placeholder="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    fullWidth
                    autoComplete="current-password"
                    variant={isMobile ? 'outlined' : 'standard'}
                    sx={isMobile ? mobileFieldSx : desktopFieldSx}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle password visibility"
                              onClick={() => setShowPassword((prev) => !prev)}
                              edge="end"
                              size="small"
                            >
                              {showPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Button
                    type="button"
                    variant="text"
                    onClick={() => setForgotPasswordOpen(true)}
                    sx={{
                      px: 0,
                      fontWeight: 600,
                      letterSpacing: 1,
                      color: 'text.disabled',
                    }}
                  >
                    Forgot Password?
                  </Button>
                  <Button
                    type="submit"
                    variant="text"
                    disabled={loading || !email || !password}
                    startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
                    sx={{
                      fontWeight: 600,
                      letterSpacing: 1,
                      // Larger LOGIN label for a clearer primary action, matched
                      // across mobile and desktop.
                      fontSize: 17,
                    }}
                  >
                    {loading ? 'Signing in...' : 'LOGIN'}
                  </Button>
                </Box>

                {oidcEnabled && (
                  <Box sx={{ textAlign: 'center', mt: 1 }}>
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      underline="hover"
                      onClick={() => setShowLocalForm(false)}
                    >
                      Sign in with BCIT
                    </Link>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>

        <Dialog
          open={forgotPasswordOpen}
          onClose={() => setForgotPasswordOpen(false)}
          aria-labelledby="forgot-password-dialog-title"
        >
          {/* Close (X) in the top-right corner. Positioned against the dialog
              paper (which is `position: relative`), so it sits at the corner
              regardless of the title/content size. */}
          <IconButton
            aria-label="close"
            onClick={() => setForgotPasswordOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8, color: 'text.secondary' }}
          >
            <CloseIcon />
          </IconButton>
          <DialogTitle id="forgot-password-dialog-title" sx={{ pr: 6 }}>
            Forgot Password
          </DialogTitle>
          <DialogContent>
            <Typography>Please contact the TLU Lab via Teams to reset your password.</Typography>
          </DialogContent>
        </Dialog>

        {/* Right side — splash image */}
        <Box
          sx={{
            flex: '0 0 50%',
            backgroundImage: 'url(/hriv-splash2.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: { xs: 'none', md: 'block' },
          }}
        />
      </Box>
      <FooterBar canManageUsers={false} />
    </Box>
  )
}
