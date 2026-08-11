import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { useIsMobile } from '../useIsMobile'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { useColorMode } from '../useColorMode'
import { getAnnounceColors } from '../theme'

interface AnnouncementBannerProps {
  message: string
  variant?: 'login' | 'app'
  onDismiss?: () => void
}

/**
 * Compact "What's New" announcement banner for mobile: an info-style strip
 * with the body clamped to a single line and a more/less toggle. Theme-aware
 * (light / dark / auto). Used on small screens for both the app and login
 * contexts; desktop keeps the standard MUI Alert below.
 */
function MobileAnnouncement({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const { mode } = useColorMode()
  const c = getAnnounceColors(mode)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)

  // Only offer more/less when the message actually gets clamped — a short
  // announcement has nothing more to reveal. Measured while collapsed (once
  // expanded the element always fits, so the last known value is kept) and
  // re-measured on resize, since the clamp depends on the available width.
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
    <Box
      sx={{
        bgcolor: c.bg,
        px: '14px',
        py: '8px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
      }}
    >
      {/* The info icon is the sole "What's New" indicator now — a bit larger so
          it reads as the primary marker without a text label. */}
      <InfoOutlinedIcon sx={{ fontSize: 19, color: c.icon, mt: '2px', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          component="p"
          ref={textRef}
          sx={{
            m: 0,
            fontSize: 14,
            color: c.fg,
            lineHeight: 1.5,
            ...(expanded
              ? {}
              : {
                  display: '-webkit-box',
                  WebkitLineClamp: 1,
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
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: c.btn,
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              mt: '1px',
              p: 0,
              opacity: 0.8,
              fontFamily: 'inherit',
            }}
          >
            {expanded ? (
              <>
                <ExpandLessIcon sx={{ fontSize: 14 }} />
                less
              </>
            ) : (
              <>
                <ExpandMoreIcon sx={{ fontSize: 14 }} />
                more
              </>
            )}
          </Box>
        )}
      </Box>
      {onDismiss && (
        <IconButton
          onClick={onDismiss}
          aria-label="Dismiss"
          size="small"
          sx={{ color: c.dismiss, p: '2px', flexShrink: 0, mt: '-2px' }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
    </Box>
  )
}

export default function AnnouncementBanner({
  message,
  variant = 'app',
  onDismiss,
}: AnnouncementBannerProps) {
  const isMobile = useIsMobile()

  if (!message) return null

  // The compact "What's New" strip is used on mobile everywhere, and on the
  // login screen at every width — that page follows the mobile design language,
  // so a filled Alert there would look out of place. The caller owns the
  // surrounding width/placement.
  if (isMobile || variant === 'login') {
    return <MobileAnnouncement message={message} onDismiss={onDismiss} />
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
