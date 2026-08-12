import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  onDismiss?: () => void
}

/**
 * Login-page announcement: a filled info banner whose message is clamped to two
 * lines with a more/less toggle, and a close (X) button when `onDismiss` is
 * provided. Kept visually in the same filled style as the app banner.
 */
function LoginAnnouncement({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
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
    <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
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
    </Box>
  )
}

export default function AnnouncementBanner({
  message,
  variant = 'app',
  onDismiss,
}: AnnouncementBannerProps) {
  if (!message) return null

  if (variant === 'login') {
    return <LoginAnnouncement message={message} onDismiss={onDismiss} />
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
