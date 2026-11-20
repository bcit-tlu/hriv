import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ApiAnnouncement } from '../api'
import { selectNotices } from '../announcementUtils'
import AnnouncementCard from './AnnouncementCard'

export interface NoticesShelfProps {
  announcements: ApiAnnouncement[]
  /** Opens the Announcements page, optionally focused on one post. */
  onOpenAnnouncements?: (announcementId?: number) => void
  /** Called when a reader collapses an unseen post ("Show less"). */
  onMarkSeen?: (announcement: ApiAnnouncement) => void
}

// Keyed by notify version so "Notify readers again" re-expands a post the reader collapsed.
const versionKey = (a: ApiAnnouncement) => `${a.id}:${a.notified_at ?? ''}`

/**
 * Home shelf of up to three pinned, live announcements; renders nothing when there are none.
 * Unseen posts show in full; seen ones collapse to their title until the reader expands them.
 */
export default function NoticesShelf({
  announcements,
  onOpenAnnouncements,
  onMarkSeen,
}: NoticesShelfProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const notices = selectNotices(announcements)
  if (notices.length === 0) return null
  return (
    <Box component="section" aria-labelledby="notices-shelf-heading" sx={{ mb: 3 }}>
      <Stack direction="row" alignItems="baseline" sx={{ mb: 1 }}>
        <Typography id="notices-shelf-heading" variant="h6" component="h2" sx={{ flex: 1 }}>
          Notices
        </Typography>
        {onOpenAnnouncements && (
          <Button size="small" onClick={() => onOpenAnnouncements()}>
            All announcements
          </Button>
        )}
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ '& > *': { flex: { md: 1 }, minWidth: 0 } }}
      >
        {notices.map((a) => {
          const key = versionKey(a)
          const open = expanded[key] ?? !a.seen
          return (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              compact
              collapsed={!open}
              onToggleCollapsed={() => {
                if (open && !a.seen) onMarkSeen?.(a)
                setExpanded((prev) => ({ ...prev, [key]: !open }))
              }}
              onOpen={onOpenAnnouncements ? () => onOpenAnnouncements(a.id) : undefined}
            />
          )
        })}
      </Stack>
    </Box>
  )
}
