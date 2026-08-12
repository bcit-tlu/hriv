import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  onDismiss?: () => void
}

/**
 * Filled info alert whose message is clamped to two lines with a more/less
 * toggle and a close (X) button when `onDismiss` is provided. Shared by the
 * login screen and — on mobile — the authenticated app banner so both read
 * identically. Width is controlled by the caller (no intrinsic max-width).
 */
function ClampedAnnouncementAlert({
  message,
  onDismiss,
}: {
  message: string
  onDismiss?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)

  // Only offer more/less when the message actually exceeds two lines. Measured
  // while collapsed (once expanded it always fits, so the last value is kept)
  // and re-measured on resize since the clamp depends on the available width.
  useEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (!el) return
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [message, expanded])

  const showToggle = overflowing || expanded

  return (
    <Alert
      severity="info"
      variant="filled"
      onClose={onDismiss}
      sx={{ '& .MuiAlert-message': { minWidth: 0, flex: 1 } }}
    >
      <Typography
        ref={textRef}
        component="p"
        sx={{
          m: 0,
          ...(expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
        }}
      >
        {message}
      </Typography>
      {showToggle && (
        <Box
          component="button"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          sx={{
            mt: 0.5,
            p: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 600,
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'less' : 'more'}
        </Box>
      )}
    </Alert>
  )
}

export default function AnnouncementBanner({
  message,
  variant = 'app',
  onDismiss,
}: AnnouncementBannerProps) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  if (!message) return null

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
        <ClampedAnnouncementAlert message={message} onDismiss={onDismiss} />
      </Box>
    )
  }

  // App banner: on mobile it mirrors the login screen's treatment (two-line
  // clamp + more/less + X) so both surfaces read identically. Desktop keeps the
  // wider filled alert with a text "Dismiss" action.
  if (isMobile) {
    return <ClampedAnnouncementAlert message={message} onDismiss={onDismiss} />
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
