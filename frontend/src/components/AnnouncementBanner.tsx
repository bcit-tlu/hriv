import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import { useTheme } from '@mui/material/styles'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  onDismiss?: () => void
}

export default function AnnouncementBanner({ message, variant = 'app', onDismiss }: AnnouncementBannerProps) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  if (!message) return null

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
        <Alert
          severity="info"
          variant="standard"
          sx={isDark ? { bgcolor: '#1a3a5c', color: '#90caf9' } : undefined}
        >
          {message}
        </Alert>
      </Box>
    )
  }

  return (
    <Alert
      severity="info"
      variant="standard"
      action={
        onDismiss ? (
          <Link
            component="button"
            underline="always"
            color="inherit"
            onClick={onDismiss}
            sx={{ whiteSpace: 'nowrap', fontSize: 'inherit' }}
          >
            Dismiss
          </Link>
        ) : undefined
      }
      sx={{
        borderRadius: 0,
        justifyContent: 'center',
        '& .MuiAlert-message': { textAlign: 'center' },
        ...(isDark && { bgcolor: '#1a3a5c', color: '#90caf9' }),
      }}
    >
      {message}
    </Alert>
  )
}
