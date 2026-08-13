import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

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
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  if (!message) return null

  // Mobile close affordance: a compact × pinned to the alert's top-right
  // corner (the MUI action slot is top-aligned by default).
  const closeIcon = onDismiss ? (
    <IconButton aria-label="Dismiss announcement" color="inherit" size="small" onClick={onDismiss}>
      <CloseIcon fontSize="small" />
    </IconButton>
  ) : undefined

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', mb: 3 }}>
        <Alert
          severity="info"
          variant="filled"
          action={isMobile ? closeIcon : undefined}
          sx={{ '& .MuiAlert-action': { mr: 0 } }}
        >
          {message}
        </Alert>
      </Box>
    )
  }

  return (
    <Alert
      severity="info"
      variant="filled"
      // Mobile: a top-right × icon. Desktop: the original "Dismiss" text button.
      action={
        isMobile ? (
          closeIcon
        ) : onDismiss ? (
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
