import { useState, useEffect } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import AnnouncementBanner from './AnnouncementBanner'
import { fetchOidcEnabled, getOidcLoginUrl } from '../api'

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>
  announcement?: string
}

export default function LoginScreen({ onLogin, announcement }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)

  useEffect(() => {
    fetchOidcEnabled()
      .then((res) => setOidcEnabled(res.enabled))
      .catch(() => setOidcEnabled(false))
  }, [])

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

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: '#fff',
      }}
    >
      {/* Left side — form */}
      <Box
        sx={{
          flex: '0 0 50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, sm: 6, md: 8 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          {announcement && (
            <AnnouncementBanner message={announcement} variant="login" />
          )}

          {/* BCIT logo + Login heading */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 5 }}>
            <Box
              component="img"
              src="/bcit-logo.svg"
              alt="BCIT"
              sx={{ height: 48 }}
            />
            <Typography variant="h5" sx={{ fontWeight: 400 }}>
              Corgi Login
            </Typography>
          </Box>

          {oidcEnabled && (
            <Box sx={{ mb: 2 }}>
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
              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  or sign in with email
                </Typography>
              </Divider>
            </Box>
          )}

          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <TextField
              placeholder="username@bcit.ca"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              autoFocus
              autoComplete="email"
              variant="standard"
            />

            <TextField
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
              autoComplete="current-password"
              variant="standard"
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

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="submit"
                variant="text"
                disabled={loading || !email || !password}
                startIcon={
                  loading ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : undefined
                }
                sx={{ fontWeight: 600, letterSpacing: 1 }}
              >
                {loading ? 'Signing in...' : 'LOGIN'}
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Right side — splash image */}
      <Box
        sx={{
          flex: '0 0 50%',
          backgroundImage: 'url(/login-splash.jpg?v=2)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: { xs: 'none', md: 'block' },
        }}
      />
    </Box>
  )
}
