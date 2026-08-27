import Alert from '@mui/material/Alert'
import type { AlertProps } from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'

export interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  alertVariant?: AlertProps['variant']
  color?: AlertProps['color']
  severity?: AlertProps['severity']
  onDismiss?: () => void
}

export default function AnnouncementBanner({
  message,
  variant = 'app',
  alertVariant = 'filled',
  color,
  severity = 'info',
  onDismiss,
}: AnnouncementBannerProps) {
  if (!message) return null

  const alert = (
    <Alert
      action={
        variant === 'app' && onDismiss ? (
          <Button color="inherit" size="small" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : undefined
      }
      color={color}
      severity={severity}
      sx={{ '& .MuiAlert-action': { mr: 0 } }}
      variant={alertVariant}
    >
      {message}
    </Alert>
  )

  if (variant === 'login') {
    return <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>{alert}</Box>
  }

  return alert
}
