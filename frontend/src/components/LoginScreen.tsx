import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
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
import { useIsMobile } from '../useIsMobile'
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
  const isMobile = useIsMobile()

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

  // A back arrow returns from the local form to the landing, on both layouts.
  const showBackToLanding = showLocalForm

  // ── Field styling (design) ─────────────────────────────────────────────────
  // The design places the field label *above* a bordered, surface-filled input
  // rather than using MUI's floating label, so we render our own <label> (tied
  // to the input via htmlFor/id) and an outlined field. Shared by both layouts,
  // scaled up slightly on desktop.
  const fieldLabelSx = {
    display: 'block',
    fontSize: { xs: 12, md: 13 },
    fontWeight: 500,
    color: 'primary.main',
    mb: 1,
  }
  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: 'background.paper',
      borderRadius: 1.5,
    },
    '& .MuiOutlinedInput-input': {
      py: { xs: 1.25, md: 1.5 },
      fontSize: { xs: 14, md: 15 },
    },
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        // Sits on the page (grey) surface so the white input fields and banner
        // read as raised, matching the design.
        bgcolor: 'background.default',
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
        {/* ── Left half ──────────────────────────────────────────────────────
            Owns its own header row and (on desktop) the announcement, so
            neither can stray over the splash image on the right. */}
        <Box
          sx={{
            flex: { sm: '1 1 100%', md: '0 0 50%' },
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {/* Top section — announcement first, then the back arrow / theme
              toggle row beneath it. Kept in the normal flow so the block below
              can never ride up underneath it, however tall the announcement or
              the form gets. */}
          <Box>
            {/* Desktop announcement — top of the left half, inset so a long
                message doesn't span the full column. Mobile renders it
                full-bleed above this whole section instead. */}
            {!isMobile && announcement && (
              <Box sx={{ width: '84%', mx: 'auto', pt: 1.5 }}>
                <AnnouncementBanner
                  message={announcement}
                  variant="login"
                  onDismiss={onDismissAnnouncement}
                />
              </Box>
            )}

            {/* Back arrow (left, only when there's a landing to return to) and
                theme toggle (right). Scoped to this half so the toggle never
                lands on the splash image. */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                pt: { xs: 1.5, md: 1 },
                // The sm step matters: between 600–899px there is no splash, so
                // the left half spans the viewport and 12px would leave the
                // arrow/toggle hugging the screen edges.
                px: { xs: 1.5, sm: 4, md: 3 },
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
          </Box>

          {/* Form area — top-anchored on mobile (the design flows from the
              top); vertically centred beside the splash on desktop. */}
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: isMobile ? 'flex-start' : 'center',
              justifyContent: 'center',
              px: { xs: 3, sm: 6, md: 8 },
              pt: { xs: 3.5, md: 0 },
            }}
          >
            {/* The desktop nudge is a transform rather than padding so it lifts
                the block off dead centre without adding any layout height —
                padding here would push the page past the viewport and
                introduce a scrollbar on shorter windows. */}
            <Box
              sx={{
                width: '100%',
                maxWidth: 400,
                transform: { md: 'translateY(-24px)' },
              }}
            >
              {/* Brand header — the design's centred "H" mark, shared by both
                layouts and scaled up on desktop. */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    width: { xs: 64, md: 68 },
                    height: { xs: 64, md: 68 },
                    borderRadius: '50%',
                    bgcolor: '#C0392B',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: { xs: 26, md: 31 },
                    fontWeight: 700,
                    boxShadow: '0 4px 20px rgba(192,57,43,0.4)',
                  }}
                >
                  H
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography
                    sx={{
                      fontSize: { xs: 17, md: 21 },
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                    }}
                  >
                    HRIV
                  </Typography>
                  <Typography
                    sx={{ mt: 0.75, fontSize: { xs: 11, md: 13 }, color: 'text.secondary' }}
                  >
                    High Resolution Image Viewer
                  </Typography>
                </Box>
              </Box>
              <Divider />

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
                    gap: 3,
                    // Design leaves a generous gap between the divider and the
                    // primary action.
                    mt: { xs: 6, md: 6 },
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
                    gap: { xs: 2.5, md: 3 },
                    mt: { xs: 2.5, md: 2 },
                  }}
                >
                  {/* "Local Account" heading, per the design. */}
                  <Typography
                    sx={{
                      textAlign: 'center',
                      fontSize: { xs: 15, md: 16 },
                      fontWeight: 500,
                      color: 'text.secondary',
                    }}
                  >
                    Local Account
                  </Typography>

                  {error && (
                    <Alert severity="error" onClose={() => setError(null)}>
                      {error}
                    </Alert>
                  )}

                  <Box>
                    <Typography component="label" htmlFor="login-username" sx={fieldLabelSx}>
                      Username *
                    </Typography>
                    <TextField
                      id="login-username"
                      hiddenLabel
                      placeholder="username@example.ca"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      fullWidth
                      autoFocus
                      autoComplete="email"
                      variant="outlined"
                      sx={fieldSx}
                    />
                  </Box>

                  <Box>
                    <Typography component="label" htmlFor="login-password" sx={fieldLabelSx}>
                      Password *
                    </Typography>
                    <TextField
                      id="login-password"
                      hiddenLabel
                      placeholder="Password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      fullWidth
                      autoComplete="current-password"
                      variant="outlined"
                      sx={fieldSx}
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
                        fontSize: { xs: 11, md: 12 },
                        minWidth: 0,
                      }}
                    >
                      Forgot Password?
                    </Button>
                    <Button
                      type="submit"
                      variant="text"
                      disabled={loading || !email || !password}
                      startIcon={
                        loading ? <CircularProgress size={18} color="inherit" /> : undefined
                      }
                      sx={{
                        fontWeight: 600,
                        letterSpacing: 1,
                        fontSize: { xs: 12, md: 13 },
                        minWidth: 0,
                        px: 0,
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
      <FooterBar canManageUsers={false} fullWidth />
    </Box>
  )
}
