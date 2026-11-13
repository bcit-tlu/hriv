import { useState } from 'react'
import Alert from '@mui/material/Alert'
import type { AlertProps } from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import CloseIcon from '@mui/icons-material/Close'
import { kindAlertSx, kindMeta, type AnnouncementKindMeta } from '../announcementKinds'
import type { MediaTokens } from '../markdownUtils'
import MarkdownContent from './MarkdownContent'

export interface AnnouncementBannerProps {
  message: string
  /** Per-response `{ mediaId: token }` so `/api/media/{id}` images/video resolve. */
  mediaTokens?: MediaTokens
  title?: string
  /** Announcement kind: supplies the icon and accent colour (same as the card). */
  kind?: string
  /** `login`: compact card above the login form. `app`: full-width strip under the AppBar. */
  variant?: 'login' | 'app'
  alertVariant?: AlertProps['variant']
  color?: AlertProps['color']
  severity?: AlertProps['severity']
  /** Closes the banner (marks the post seen). Absent on the login screen. */
  onDismiss?: () => void
  /** Number of further banner posts; renders "+N more" when > 0. */
  moreCount?: number
  onMore?: () => void
  /** Clamp the body to two lines with a more/less toggle (default on). */
  clamp?: boolean
}

/**
 * Kind icon for cards and banners. Informational-icon convention: a non-interactive
 * `role="img"` span carries the label — not `titleAccess` on the bare SVG (#1567).
 */
export function KindIcon({ meta }: { meta: AnnouncementKindMeta }) {
  return (
    <Box component="span" role="img" aria-label={meta.label} sx={{ display: 'inline-flex' }}>
      <meta.Icon fontSize="inherit" />
    </Box>
  )
}

export default function AnnouncementBanner({
  message,
  mediaTokens,
  title,
  kind,
  variant = 'app',
  alertVariant = 'outlined',
  color,
  severity,
  onDismiss,
  moreCount = 0,
  onMore,
  clamp = true,
}: AnnouncementBannerProps) {
  const [expanded, setExpanded] = useState(false)
  if (!message && !title) return null
  const clamped = clamp && !expanded
  const longBody = message.length > 160 || message.includes('\n')
  const meta = kind ? kindMeta(kind) : null

  const alert = (
    <Alert
      role="status"
      severity={severity ?? meta?.severity ?? 'info'}
      color={color}
      variant={alertVariant}
      icon={meta ? <KindIcon meta={meta} /> : false}
      action={
        onDismiss && variant === 'app' ? (
          <IconButton
            aria-label="Close announcement"
            size="small"
            color="inherit"
            onClick={onDismiss}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : undefined
      }
      sx={{
        ...(meta ? kindAlertSx(meta) : {}),
        alignItems: 'flex-start',
        '& .MuiAlert-message': { flex: 1, minWidth: 0, py: 0.5 },
        '& .MuiAlert-action': { mr: 0, pt: 0 },
      }}
    >
      {title && <AlertTitle sx={{ mb: 0.25, fontWeight: 600 }}>{title}</AlertTitle>}
      {message && (
        <MarkdownContent
          markdown={message}
          mediaTokens={mediaTokens}
          sx={
            clamped
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  '& p:last-child': { mb: 0 },
                }
              : { '& p:last-child': { mb: 0 } }
          }
        />
      )}
      {(longBody && clamp) || moreCount > 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          {longBody && clamp && (
            <Button
              size="small"
              color="inherit"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              sx={{ px: 0.5, minWidth: 0 }}
            >
              {expanded ? 'Less' : 'More'}
            </Button>
          )}
          {moreCount > 0 && onMore && (
            <Button size="small" color="inherit" onClick={onMore} sx={{ px: 0.5, minWidth: 0 }}>
              +{moreCount} more
            </Button>
          )}
        </Stack>
      ) : null}
    </Alert>
  )

  if (variant === 'login') {
    return <Box sx={{ width: '100%', maxWidth: 400, mb: 3 }}>{alert}</Box>
  }
  return alert
}
