import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
}

export default function AnnouncementBanner({ message, variant = 'app' }: AnnouncementBannerProps) {
  if (!message) return null

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
        <Alert severity="info" variant="standard">
          {message}
        </Alert>
      </Box>
    )
  }

  return (
    <Alert
      severity="info"
      variant="filled"
      sx={{
        borderRadius: 0,
        justifyContent: 'center',
        '& .MuiAlert-message': { textAlign: 'center' },
      }}
    >
      {message}
    </Alert>
  )
}
