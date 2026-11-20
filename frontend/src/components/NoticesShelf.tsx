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
}

/** Home shelf of up to three pinned, live announcements; renders nothing when there are none. */
export default function NoticesShelf({ announcements, onOpenAnnouncements }: NoticesShelfProps) {
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
        {notices.map((a) => (
          <AnnouncementCard
            key={a.id}
            announcement={a}
            compact
            onOpen={onOpenAnnouncements ? () => onOpenAnnouncements(a.id) : undefined}
          />
        ))}
      </Stack>
    </Box>
  )
}
