import { useState, type MouseEvent } from 'react'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
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
import { ANNOUNCEMENT_REACTIONS, kindMeta } from '../announcementKinds'
import { formatRelativeTime } from '../formatUtils'

export const BELL_PEEK_LIMIT = 5

export interface AnnouncementsBellProps {
  announcements: ApiAnnouncement[]
  unseenCount: number
  /** Open the Announcements page, optionally scrolled to one post. */
  onOpenAnnouncements: (announcementId?: number) => void
  /** Reaction pills under each peeked post (omit to hide them). */
  onToggleReaction?: (announcement: ApiAnnouncement, emoji: string) => void
}

/** Bell for every role: a peek at the newest unseen posts, "See all" → the page. */
export default function AnnouncementsBell({
  announcements,
  unseenCount,
  onOpenAnnouncements,
  onToggleReaction,
}: AnnouncementsBellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unseen = announcements
    .filter((a) => !a.seen && a.status === 'live')
    .slice(0, BELL_PEEK_LIMIT)
  const close = () => setAnchor(null)
  const go = (id?: number) => {
    close()
    onOpenAnnouncements(id)
  }

  return (
    <>
      <Tooltip title="Announcements">
        <IconButton
          color="inherit"
          aria-label={unseenCount > 0 ? `Announcements, ${unseenCount} unseen` : 'Announcements'}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        >
          <Badge badgeContent={unseenCount} color="error" max={99}>
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
                  <ListItemButton onClick={() => go(a.id)}>
                    <ListItemIcon sx={{ minWidth: 36, color: `${meta.severity}.main` }}>
                      <meta.Icon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={a.title}
                      secondary={formatRelativeTime(a.notified_at ?? a.publish_at ?? a.created_at)}
                      slotProps={{ primary: { noWrap: true, fontWeight: 600 } }}
                    />
                  </ListItemButton>
                  {onToggleReaction && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ px: 2, pb: 1, pl: 6.5, flexWrap: 'wrap' }}
                    >
                      {ANNOUNCEMENT_REACTIONS.filter(
                        (r) => (a.reactions[r.id] ?? 0) > 0 || a.my_reactions.includes(r.id),
                      ).map((r) => {
                        const mine = a.my_reactions.includes(r.id)
                        return (
                          <Chip
                            key={r.id}
                            size="small"
                            label={`${r.glyph} ${a.reactions[r.id] ?? 0}`}
                            color={mine ? 'primary' : 'default'}
                            variant={mine ? 'filled' : 'outlined'}
                            aria-pressed={mine}
                            aria-label={`${r.id} reaction, ${a.reactions[r.id] ?? 0}`}
                            onClick={() => onToggleReaction(a, r.id)}
                          />
                        )
                      })}
                    </Stack>
                  )}
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
