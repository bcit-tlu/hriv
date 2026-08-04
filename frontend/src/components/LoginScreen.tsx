import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import AnnouncementBanner from './AnnouncementBanner'
import ColorModeToggle from './ColorModeToggle'
import { getOidcLoginUrl } from '../api'
import { useAuth } from '../useAuth'
import FooterBar from './FooterBar'

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>
  announcement?: string
  /** Dismiss the announcement (persists so it stays hidden until updated). */
  onDismissAnnouncement?: () => void
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

export default function LoginScreen({
  onLogin,
  announcement,
  onDismissAnnouncement,
}: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLocalForm, setShowLocalForm] = useState(false)
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const { oidcError, clearOidcError } = useAuth()
  const muiTheme = useTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'))

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

  // The sign-in landing ("Sign in with BCIT" + "Use a local user") is always
  // the entry point; the local credential form is only reached by opting into
  // it. This is deliberately independent of whether the backend reports OIDC
  // as configured, so the landing never gets skipped.
  const showOidcDefault = !showLocalForm

  // Mobile shows a back arrow returning from the local form to the landing.
  const showBackToLanding = isMobile && showLocalForm

  // ── Mobile field styling (design) ──────────────────────────────────────────
  // The design places the field label *above* a bordered, surface-filled input
  // rather than using MUI's floating label, so mobile renders its own <label>
  // (still tied to the input via htmlFor/id) and an outlined field.
  const fieldLabelSx = {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'primary.main',
    mb: 0.75,
  }
  const mobileFieldSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: 'background.paper',
      borderRadius: 1.5,
    },
    '& .MuiOutlinedInput-input': {
      py: 1.25,
      fontSize: 14,
    },
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        // Mobile sits on the page (grey) surface so the white input fields and
        // banner read as raised, matching the design. Desktop keeps paper.
        bgcolor: isMobile ? 'background.default' : 'background.paper',
      }}
    >
      {/* Mobile: the announcement spans the full viewport width at the very
          top, above the theme toggle. Desktop keeps it inside the form column. */}
      {isMobile && announcement && (
        <AnnouncementBanner
          message={announcement}
          variant="login"
          onDismiss={onDismissAnnouncement}
        />
      )}
      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          ...(isMobile && { flexDirection: 'column' }),
          position: 'relative',
        }}
      >
        {/* Header row. Mobile keeps these in the normal flow — back arrow on
            the left (only when there's a landing page to return to) and the
            theme toggle on the right, so neither can overlap the banner.
            Desktop keeps the toggle pinned to the top-right corner. */}
        {isMobile ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pt: 1.5,
              px: 1.5,
            }}
          >
            {showBackToLanding ? (
              <IconButton
                onClick={() => setShowLocalForm(false)}
                aria-label="Back to sign-in options"
                sx={{ color: 'text.secondary' }}
              >
                <ArrowBackIcon />
              </IconButton>
            ) : (
              // Spacer keeps the toggle hard-right when there's no back arrow.
              <Box />
            )}
            <ColorModeToggle
              iconButtonSx={{
                color: 'text.secondary',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: 'background.paper',
              }}
            />
          </Box>
        ) : (
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

        {/* Left side — form. Top-anchored on mobile (the design flows from the
            top); vertically centred beside the splash on desktop. */}
        <Box
          sx={{
            flex: { sm: '1 1 100%', md: '0 0 50%' },
            display: 'flex',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'center',
            px: { xs: 3, sm: 6, md: 8 },
            ...(isMobile && { pt: 3.5 }),
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 400 }}>
            {!isMobile && announcement && (
              <AnnouncementBanner message={announcement} variant="login" />
            )}

            {/* Header — centered "H" brand on mobile, BCIT logo + heading on desktop */}
            {isMobile ? (
              <>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1.25,
                    mb: 3,
                  }}
                >
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      bgcolor: '#C0392B',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 26,
                      fontWeight: 700,
                      boxShadow: '0 4px 20px rgba(192,57,43,0.4)',
                    }}
                  >
                    H
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.06em' }}>
                      HRIV
                    </Typography>
                    <Typography sx={{ mt: '3px', fontSize: 11, color: 'text.secondary' }}>
                      High Resolution Image Viewer
                    </Typography>
                  </Box>
                </Box>
                <Divider />
              </>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  mb: 5,
                }}
              >
                <Box component="img" src="/bcit-logo.svg" alt="BCIT" sx={{ height: 48 }} />
                <Typography variant="h5" sx={{ fontWeight: 400 }}>
                  High Resolution Image Viewer (HRIV) Login
                </Typography>
              </Box>
            )}

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
                  // Design leaves a generous gap between the divider and the
                  // primary action on mobile.
                  ...(isMobile && { mt: 6 }),
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
                  Use a local user
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
                  gap: isMobile ? 2 : 3,
                  ...(isMobile && { mt: 2 }),
                }}
              >
                {/* "Local Account" heading — mobile only, per the design. */}
                {isMobile && (
                  <Typography
                    sx={{
                      textAlign: 'center',
                      fontSize: 15,
                      fontWeight: 500,
                      color: 'text.secondary',
                    }}
                  >
                    Local Account
                  </Typography>
                )}

                {error && (
                  <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                  </Alert>
                )}

                <Box>
                  {isMobile && (
                    <Typography component="label" htmlFor="login-username" sx={fieldLabelSx}>
                      Username *
                    </Typography>
                  )}
                  <TextField
                    id="login-username"
                    {...(isMobile ? { hiddenLabel: true } : { label: 'Username' })}
                    placeholder="username@example.ca"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    fullWidth
                    autoFocus
                    autoComplete="email"
                    variant={isMobile ? 'outlined' : 'standard'}
                    sx={isMobile ? mobileFieldSx : undefined}
                  />
                </Box>

                <Box>
                  {isMobile && (
                    <Typography component="label" htmlFor="login-password" sx={fieldLabelSx}>
                      Password *
                    </Typography>
                  )}
                  <TextField
                    id="login-password"
                    {...(isMobile ? { hiddenLabel: true } : { label: 'Password' })}
                    placeholder="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    fullWidth
                    autoComplete="current-password"
                    variant={isMobile ? 'outlined' : 'standard'}
                    sx={isMobile ? mobileFieldSx : undefined}
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
                      ...(isMobile && { fontSize: 11, minWidth: 0 }),
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
                      ...(isMobile && { fontSize: 12, minWidth: 0, px: 0 }),
                    }}
                  >
                    {loading ? 'Signing in...' : 'LOGIN'}
                  </Button>
                </Box>

                {/* Route back to the landing. This is the only way back on
                    desktop, where the mobile back arrow isn't rendered. */}
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
              </Box>
            )}
          </Box>
        </Box>

        <Dialog
          open={forgotPasswordOpen}
          onClose={() => setForgotPasswordOpen(false)}
          aria-labelledby="forgot-password-dialog-title"
        >
          <DialogTitle id="forgot-password-dialog-title">Forgot Password</DialogTitle>
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
