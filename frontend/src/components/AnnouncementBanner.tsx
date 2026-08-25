import { useLayoutEffect, useRef, useState } from 'react'
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

// Renders the announcement text clamped to 2 lines with a More/Less toggle.
// The toggle only appears when the text actually overflows those 2 lines,
// which we detect by comparing the clamped element's scroll vs client height.
function ClampableMessage({ message }: { message: string }) {
  const textRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const measure = () => {
      // Overflow is only measurable while clamped; once expanded we keep the
      // last verdict so the "Less" toggle stays put.
      if (expanded) return
      setOverflowing(el.scrollHeight - el.clientHeight > 1)
    }
    measure()
    // Re-measure whenever the text box is re-laid-out (container width or
    // orientation change). ResizeObserver fires after reflow, so the reading
    // is never stale — unlike a window "resize" handler.
    const onResize: ResizeObserverCallback = () => {
      measure()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [message, expanded])

  return (
    <Box>
      <Box
        ref={textRef}
        sx={
          expanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {message}
      </Box>
      {overflowing && (
        <Button
          color="inherit"
          size="small"
          onClick={() => setExpanded((v) => !v)}
          sx={{
            p: 0,
            mt: 0.5,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            fontStyle: 'italic',
            textTransform: 'none',
            textDecoration: 'underline',
            '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' },
          }}
        >
          {expanded ? 'Less' : 'More'}
        </Button>
      )}
    </Box>
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

  // Mobile close affordance: a compact × pinned to the alert's top-right
  // corner (the MUI action slot is top-aligned by default).
  const closeIcon = onDismiss ? (
    <IconButton aria-label="Dismiss announcement" color="inherit" size="small" onClick={onDismiss}>
      <CloseIcon sx={{ fontSize: 24 }} />
    </IconButton>
  ) : undefined

  // Colour combo tuned for readability on the blue banner in both modes.
  // Deep, saturated blue + pure white text: ~8.6:1 (light) and ~5.9:1 (dark),
  // both comfortably above WCAG-AA. Dark mode uses a slightly lighter blue so
  // the banner reads as a distinct surface on the near-black page.
  const onInfo = '#FFFFFF'
  const infoBg = theme.palette.mode === 'dark' ? '#1565C0' : '#0D47A1'
  const alertSx = {
    borderRadius: isMobile ? 2 : undefined,
    backgroundColor: infoBg,
    color: onInfo,
    '& .MuiAlert-icon': { color: onInfo, fontSize: 26 },
    '& .MuiAlert-message': { color: onInfo, fontSize: '1rem', fontWeight: 400 },
    '& .MuiAlert-action': { mr: 0 },
  }

  if (variant === 'login') {
    return (
      <Box sx={{ width: '100%', mb: 3 }}>
        <Alert
          severity="info"
          variant="filled"
          action={isMobile ? closeIcon : undefined}
          sx={alertSx}
        >
          {/* key on the message so a new announcement remounts with fresh
              expand/overflow state (no stale "Less" toggle after an edit). */}
          <ClampableMessage key={message} message={message} />
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
      sx={alertSx}
    >
      <ClampableMessage message={message} />
    </Alert>
  )
}
