import { useState, type MouseEvent } from 'react'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import NotificationsIcon from '@mui/icons-material/Notifications'
import type { ApiAnnouncement } from '../api'
import { kindMeta } from '../announcementKinds'
import { formatRelativeTime } from '../formatUtils'

export const BELL_PEEK_LIMIT = 5

export interface AnnouncementsBellProps {
  announcements: ApiAnnouncement[]
  unseenCount: number
  /** Open the Announcements page, optionally scrolled to one post. */
  onOpenAnnouncements: (announcementId?: number) => void
  /** Reaction pills under each peeked post (omit to hide them). */
  /** Called when a peeked post is opened; the item leaves the peek and the badge shrinks. */
  onMarkSeen?: (announcement: ApiAnnouncement) => void
}

/** Bell for every role: a peek at the newest unseen posts, "See all" → the page. */
export default function AnnouncementsBell({
  announcements,
  unseenCount,
  onOpenAnnouncements,
  onMarkSeen,
}: AnnouncementsBellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unseen = announcements
    .filter((a) => !a.seen && a.status === 'live')
    .slice(0, BELL_PEEK_LIMIT)
  const close = () => setAnchor(null)
  const go = (a?: ApiAnnouncement) => {
    close()
    if (a) onMarkSeen?.(a)
    onOpenAnnouncements(a?.id)
  }

  return (
    <>
      <Tooltip title="Announcements">
        <IconButton
          color="inherit"
          aria-label={unseenCount > 0 ? `Announcements, ${unseenCount} unseen` : 'Announcements'}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        >
          <Badge
            variant="dot"
            color="warning"
            invisible={unseenCount === 0}
            overlap="circular"
            // A small amber dot (no number) with a ring in the bar colour so it reads on the red AppBar.
            sx={{ '& .MuiBadge-dot': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` } }}
          >
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 340, maxWidth: '90vw' } } }}
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="subtitle2">Announcements</Typography>
        </Box>
        <Divider />
        {unseen.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
            You're all caught up.
          </Typography>
        ) : (
          <List dense disablePadding>
            {unseen.map((a) => {
              const meta = kindMeta(a.kind)
              return (
                <ListItem
                  key={a.id}
                  disablePadding
                  sx={{ flexDirection: 'column', alignItems: 'stretch' }}
                >
                  <ListItemButton onClick={() => go(a)}>
                    <ListItemIcon sx={{ minWidth: 36, color: `${meta.severity}.main` }}>
                      <meta.Icon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={a.title}
                      secondary={formatRelativeTime(a.notified_at ?? a.publish_at ?? a.created_at)}
                      slotProps={{ primary: { noWrap: true, fontWeight: 600 } }}
                    />
                  </ListItemButton>
                </ListItem>
              )
            })}
          </List>
        )}
        <Divider />
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" onClick={() => go()}>
            See all
          </Button>
        </Box>
      </Popover>
    </>
  )
}
