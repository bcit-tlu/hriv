import { useState, type MouseEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PushPinIcon from '@mui/icons-material/PushPin'
import type { ApiAnnouncement } from '../api'
import {
  ANNOUNCEMENT_STATUS_LABELS,
  audienceChips,
  kindAlertSx,
  kindMeta,
} from '../announcementKinds'
import { announcementTimeLabel, formatAbsolute } from '../announcementUtils'
import { KindIcon } from './AnnouncementBanner'
import AnnouncementReactions from './AnnouncementReactions'
import MarkdownContent from './MarkdownContent'

export interface AnnouncementCardProps {
  announcement: ApiAnnouncement
  /** Admin/instructor/staff viewers see "Seen by N of M" when the API supplies counts. */
  viewerIsStaff?: boolean
  /** Authors' view: non-live status chip plus Edit/Duplicate/Delete where `can_edit`. */
  manage?: boolean
  highlighted?: boolean
  onToggleReaction?: (announcement: ApiAnnouncement, emoji: string) => void
  onEdit?: (announcement: ApiAnnouncement) => void
  onDuplicate?: (announcement: ApiAnnouncement) => void
  onDelete?: (announcement: ApiAnnouncement) => void
  /** Home shelf: full Markdown body without audience chips or reactions. */
  compact?: boolean
  /** Makes the title a button (e.g. open the post on the Announcements page). */
  onOpen?: () => void
  /** Home shelf: show only the title row; the body sits behind "Expand". */
  collapsed?: boolean
  /** Adds the Collapse / Expand button at the top right, after the pin. */
  onToggleCollapsed?: () => void
}

const STATUS_COLOR = {
  draft: 'warning',
  scheduled: 'default',
  live: 'success',
  expired: 'default',
} as const

export default function AnnouncementCard({
  announcement: a,
  viewerIsStaff = false,
  manage = false,
  highlighted = false,
  onToggleReaction,
  onEdit,
  onDuplicate,
  onDelete,
  compact = false,
  onOpen,
  collapsed = false,
  onToggleCollapsed,
}: AnnouncementCardProps) {
  const meta = kindMeta(a.kind)
  const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null)
  const quiet = a.seen
  const chips = compact ? [] : audienceChips(a)
  const showSeenCount = viewerIsStaff && a.seen_count != null && a.audience_size != null
  const bodyId = `announcement-${a.id}-body`
  const collapseToggle = onToggleCollapsed && (
    <Button
      size="small"
      color="inherit"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-controls={collapsed ? undefined : bodyId}
      sx={{ px: 0.5, minWidth: 0 }}
    >
      {collapsed ? 'Expand' : 'Collapse'}
    </Button>
  )

  return (
    <Alert
      id={`announcement-${a.id}`}
      severity={meta.severity}
      // Same visual language as the banner: white fill, border and icon in the kind's accent.
      variant="outlined"
      icon={<KindIcon meta={meta} />}
      data-testid="announcement-card"
      data-seen={a.seen ? 'true' : 'false'}
      sx={{
        ...kindAlertSx(meta),
        // Drafts sit on a grey wash so they read as "not published" at a glance.
        ...(a.status === 'draft' ? { bgcolor: 'action.hover' } : {}),
        alignItems: 'flex-start',
        '& .MuiAlert-message': { flex: 1, minWidth: 0, py: 0.5 },
        boxShadow: highlighted ? (theme) => `0 0 0 2px ${theme.palette.primary.main}` : undefined,
        transition: 'box-shadow 300ms',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Typography
          variant="subtitle1"
          component="h2"
          sx={{ fontWeight: quiet ? 500 : 600, lineHeight: 1.3, flex: 1, minWidth: 160 }}
        >
          {onOpen ? (
            <Link
              component="button"
              type="button"
              onClick={onOpen}
              color="inherit"
              underline="hover"
              sx={{ font: 'inherit', textAlign: 'left' }}
            >
              {a.title}
            </Link>
          ) : (
            a.title
          )}
        </Typography>
        {!quiet && a.status === 'live' && (
          <Chip size="small" label="New" color="primary" sx={{ height: 20 }} />
        )}
        {a.pinned && (
          <Tooltip title="Pinned">
            <PushPinIcon fontSize="small" color="action" aria-label="Pinned" />
          </Tooltip>
        )}
        {collapseToggle}
        {manage && a.status !== 'live' && (
          <Chip
            size="small"
            label={ANNOUNCEMENT_STATUS_LABELS[a.status]}
            color={STATUS_COLOR[a.status]}
            variant={a.status === 'draft' ? 'filled' : 'outlined'}
          />
        )}
        {manage && a.can_edit && (onEdit || onDuplicate || onDelete) && (
          <>
            <IconButton
              size="small"
              aria-label={`Actions for ${a.title}`}
              onClick={(event: MouseEvent<HTMLElement>) => setActionsAnchor(event.currentTarget)}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={actionsAnchor}
              open={Boolean(actionsAnchor)}
              onClose={() => setActionsAnchor(null)}
            >
              {a.can_edit && onEdit && (
                <MenuItem
                  onClick={() => {
                    setActionsAnchor(null)
                    onEdit(a)
                  }}
                >
                  Edit
                </MenuItem>
              )}
              {onDuplicate && (
                <MenuItem
                  onClick={() => {
                    setActionsAnchor(null)
                    onDuplicate(a)
                  }}
                >
                  Duplicate
                </MenuItem>
              )}
              {a.can_edit && onDelete && (
                <MenuItem
                  sx={{ color: 'error.main' }}
                  onClick={() => {
                    setActionsAnchor(null)
                    onDelete(a)
                  }}
                >
                  Delete
                </MenuItem>
              )}
            </Menu>
          </>
        )}
      </Stack>

      {!collapsed && (
        <Box id={bodyId}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexWrap: 'wrap', mt: 0.25, mb: 1 }}
          >
            <Typography variant="caption" color="text.secondary">
              {a.author_name || 'Site'}
              {manage && !a.can_edit ? ' (co-managed)' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Tooltip title={formatAbsolute(a.notified_at ?? a.publish_at ?? a.created_at)}>
              <Typography variant="caption" color="text.secondary">
                {announcementTimeLabel(a)}
              </Typography>
            </Tooltip>
            {chips.map((chip) => (
              <Chip key={chip} size="small" variant="outlined" label={chip} sx={{ height: 20 }} />
            ))}
          </Stack>

          {a.message && <MarkdownContent markdown={a.message} mediaTokens={a.media_tokens} />}
        </Box>
      )}

      {/* Reactions live on the Announcements page only — not on the Home shelf, bell or banner. */}
      {!compact && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mt: 1 }}>
          {showSeenCount && (
            <Typography variant="caption" color="text.secondary">
              Seen by {a.seen_count} of {a.audience_size}
            </Typography>
          )}
          <Box sx={{ ml: 'auto !important' }}>
            <AnnouncementReactions announcement={a} onToggleReaction={onToggleReaction} />
          </Box>
        </Stack>
      )}
    </Alert>
  )
}
