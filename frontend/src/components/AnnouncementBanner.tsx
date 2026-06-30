import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
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

  return (
    <Box
      sx={{
        bgcolor: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.icon}`,
        px: '14px',
        py: '8px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
      }}
    >
      <InfoOutlinedIcon sx={{ fontSize: 16, color: c.icon, mt: '1px', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          component="p"
          sx={{
            m: 0,
            mb: '3px',
            fontSize: 11,
            fontWeight: 700,
            color: c.icon,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          What's New
        </Typography>
        <Typography
          component="p"
          sx={{
            m: 0,
            fontSize: 12,
            color: c.fg,
            lineHeight: 1.55,
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
            fontSize: 11,
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
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  if (!message) return null

  // Mobile: compact "What's New" strip for both app and login contexts.
  if (isMobile) {
    if (variant === 'login') {
      return (
        <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>
          <MobileAnnouncement message={message} onDismiss={onDismiss} />
        </Box>
      )
    }
    return <MobileAnnouncement message={message} onDismiss={onDismiss} />
  }

  // Desktop: unchanged MUI Alert.
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
