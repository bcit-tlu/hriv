import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
}

export default function AnnouncementBanner({ message, variant = 'app' }: AnnouncementBannerProps) {
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
