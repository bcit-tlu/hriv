import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  onDismiss?: () => void
}

export default function AnnouncementBanner({
  message,
  variant = 'app',
  onDismiss,
}: AnnouncementBannerProps) {
  if (!message) return null

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
        <Alert severity="info" variant="filled">
          {message}
        </Alert>
      </Box>
    )
  }

  return (
    <Alert
      severity="info"
      variant="filled"
      action={
        onDismiss ? (
          <Button color="inherit" size="small" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : undefined
      }
      sx={{ '& .MuiAlert-action': { mr: 0 } }}
    >
      {message}
    </Alert>
  )
}
