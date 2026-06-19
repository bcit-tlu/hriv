import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import NotificationsIcon from '@mui/icons-material/Notifications'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { fetchChangelogEntries, markChangelogRead, type ApiChangelogEntry } from '../api'
import MarkdownContent from './MarkdownContent'

const BADGE_COLOR = '#f59e0b'

function isUnreadEntry(entry: ApiChangelogEntry, lastReadAt: string | null) {
  if (lastReadAt === null) return true
  const publishedAt = Date.parse(entry.published_at)
  const readAt = Date.parse(lastReadAt)
  if (Number.isNaN(publishedAt) || Number.isNaN(readAt)) return true
  return publishedAt > readAt
}

function resolveInitialLastReadAt(lsKey: string, serverLastReadAt: string | null) {
  return serverLastReadAt ?? localStorage.getItem(lsKey)
}

export interface NotificationMenuProps {
  userEmail: string
  serverLastReadAt: string | null
  frontendVersion: string | null
  backendVersion: string | null
  backupVersion: string | null
}

export default function NotificationMenu({
  userEmail,
  serverLastReadAt,
  frontendVersion,
  backendVersion,
  backupVersion,
}: NotificationMenuProps) {
  const lsKey = useMemo(() => `hriv_changelog_last_read_${userEmail}`, [userEmail])
  const [entries, setEntries] = useState<ApiChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<string | null>(() =>
    resolveInitialLastReadAt(`hriv_changelog_last_read_${userEmail}`, serverLastReadAt),
  )
  const markInFlightRef = useRef(false)

  useEffect(() => {
    const preferredReadAt = resolveInitialLastReadAt(lsKey, serverLastReadAt)
    setLastReadAt(preferredReadAt)
    if (serverLastReadAt !== null) {
      localStorage.setItem(lsKey, serverLastReadAt)
    }
    markInFlightRef.current = false
  }, [lsKey, serverLastReadAt])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchChangelogEntries()
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const hasUnread =
    !loading && entries.length > 0 && entries.some((entry) => isUnreadEntry(entry, lastReadAt))

  const handleMarkRead = useCallback(async () => {
    if (markInFlightRef.current) return
    markInFlightRef.current = true
    const optimisticTimestamp = new Date().toISOString()
    localStorage.setItem(lsKey, optimisticTimestamp)
    setLastReadAt(optimisticTimestamp)
    try {
      const result = await markChangelogRead()
      localStorage.setItem(lsKey, result.changelog_last_read_at)
      setLastReadAt(result.changelog_last_read_at)
    } catch {
      // Keep the optimistic clear; changelog badges are non-critical.
    } finally {
      markInFlightRef.current = false
    }
  }, [lsKey])

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          aria-label="Notifications"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: 'inherit' }}
        >
          <Badge
            variant="dot"
            invisible={!hasUnread}
            overlap="circular"
            sx={{
              '& .MuiBadge-dot': {
                bgcolor: BADGE_COLOR,
                boxShadow: '0 0 0 1.5px rgba(0,0,0,0.25)',
              },
            }}
          >
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        <Typography
          variant="caption"
          sx={{
            px: 2,
            py: 1,
            display: 'block',
            color: 'text.secondary',
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Notifications
        </Typography>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null)
            setWhatsNewOpen(true)
            void handleMarkRead()
          }}
        >
          <ListItemIcon>
            <Badge
              variant="dot"
              invisible={!hasUnread}
              overlap="circular"
              sx={{ '& .MuiBadge-dot': { bgcolor: BADGE_COLOR } }}
            >
              <AutoAwesomeIcon fontSize="small" />
            </Badge>
          </ListItemIcon>
          <ListItemText primary="What's New" />
        </MenuItem>
        <MenuItem
          component="a"
          href="https://github.com/bcit-tlu/hriv/tree/main/docs"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <MenuBookIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Documentation" />
          <OpenInNewIcon fontSize="small" sx={{ ml: 1, color: 'text.disabled' }} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            setAboutOpen(true)
          }}
        >
          <ListItemIcon>
            <InfoOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="About" />
        </MenuItem>
      </Menu>

      <Dialog
        open={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle>What's New</DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : entries.length === 0 ? (
            <Typography color="text.secondary" textAlign="center" py={2}>
              No changelog entries yet.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {entries.map((entry) => (
                <Paper key={entry.id} variant="outlined" sx={{ p: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 1,
                      mb: 1,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography variant="h6" fontWeight={700}>
                      {entry.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(entry.published_at).toLocaleDateString(undefined, {
                        dateStyle: 'medium',
                      })}
                    </Typography>
                  </Box>
                  <MarkdownContent markdown={entry.body} />
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWhatsNewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>About HRIV</DialogTitle>
        <DialogContent>
          <Typography variant="body1" fontWeight={600} gutterBottom>
            High Resolution Image Viewer
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            A web application for managing and viewing high-resolution pathology images, built by
            BCIT TLU.
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 0.75,
            }}
          >
            {(
              [
                ['Frontend', frontendVersion ?? 'dev'],
                ['Backend', backendVersion ?? '...'],
                ['Backup', backupVersion ?? '...'],
              ] as const
            ).flatMap(([label, value]) => [
              <Typography key={`${label}-label`} variant="caption" color="text.secondary">
                {label}
              </Typography>,
              <Typography key={`${label}-value`} variant="caption">
                {value}
              </Typography>,
            ])}
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" color="text.secondary">
            Licensed under the{' '}
            <Link
              href="https://github.com/bcit-tlu/hriv/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              Mozilla Public License 2.0
            </Link>
            .
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAboutOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
