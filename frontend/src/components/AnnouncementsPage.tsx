import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import {
  deleteAnnouncement,
  fetchAnnouncements,
  fetchGroups,
  fetchPrograms,
  userMessage,
  type AnnouncementStatus,
  type ApiAnnouncement,
  type ApiGroup,
  type ApiProgram,
} from '../api'
import { ANNOUNCEMENT_STATUS_LABELS, sortAnnouncements } from '../announcementKinds'
import type { User } from '../types'
import type { UseAnnouncementsResult } from '../useAnnouncements'
import AnnouncementCard from './AnnouncementCard'
import AnnouncementComposer from './AnnouncementComposer'
import type { ComposerMode } from '../announcementUtils'

export type AnnouncementsTab = 'inbox' | 'mine'

export interface AnnouncementsPageProps {
  currentUser: User
  /** Shared inbox feed (same instance as the bell). */
  feed: UseAnnouncementsResult
  /** Admin/instructor/staff: shows Mine, "New announcement" and seen counts. */
  canCompose: boolean
  /** Deep link `?page=announcements&id=…`: scroll to and highlight one card. */
  focusId?: number | null
  initialTab?: AnnouncementsTab
  /** Contextual compose ("Post to group"): open the composer with this group pre-selected. */
  composeGroupId?: number | null
  onComposeGroupConsumed?: () => void
}

const STATUS_FILTERS: Array<AnnouncementStatus | 'all'> = [
  'all',
  'draft',
  'scheduled',
  'live',
  'expired',
]

export default function AnnouncementsPage({
  currentUser,
  feed,
  canCompose,
  focusId = null,
  initialTab = 'inbox',
  composeGroupId = null,
  onComposeGroupConsumed,
}: AnnouncementsPageProps) {
  const isAdmin = currentUser.role === 'admin'
  const [tab, setTab] = useState<AnnouncementsTab>(canCompose ? initialTab : 'inbox')
  const [mine, setMine] = useState<ApiAnnouncement[]>([])
  const [mineLoaded, setMineLoaded] = useState(false)
  const [mineError, setMineError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | 'all'>('all')
  const [composer, setComposer] = useState<{
    mode: ComposerMode
    source: ApiAnnouncement | null
    groupIds?: number[]
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ApiAnnouncement | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [programs, setPrograms] = useState<ApiProgram[]>([])
  const [groups, setGroups] = useState<ApiGroup[]>([])
  const [targetsLoaded, setTargetsLoaded] = useState(false)
  const [targetsError, setTargetsError] = useState<string | null>(null)
  // "Post to group" opens the composer straight from props; consuming it clears the request.
  const contextualCompose =
    composer == null && composeGroupId != null && canCompose
      ? { mode: 'create' as ComposerMode, source: null, groupIds: [composeGroupId] }
      : null
  const activeComposer = composer ?? contextualCompose

  const loadMine = useCallback(async () => {
    try {
      setMine(sortAnnouncements(await fetchAnnouncements('mine')))
      setMineError(null)
    } catch (err) {
      setMineError(userMessage(err, 'Could not load your announcements'))
    } finally {
      setMineLoaded(true)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    if (tab === 'mine' && canCompose) void loadMine()
  }, [tab, canCompose, loadMine])

  useEffect(() => {
    if (!canCompose) return
    let cancelled = false
    Promise.all([fetchPrograms(), fetchGroups()])
      .then(([p, g]) => {
        if (cancelled) return
        setTargetsError(null)
        setPrograms(isAdmin ? p : p.filter((x) => currentUser.program_ids.includes(x.id)))
        setGroups(isAdmin ? g : g.filter((x) => x.instructor_ids.includes(currentUser.id)))
      })
      .catch((err: unknown) => {
        if (!cancelled) setTargetsError(userMessage(err, 'Could not load your programs and groups'))
      })
      .finally(() => {
        if (!cancelled) setTargetsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [canCompose, isAdmin, currentUser.id, currentUser.program_ids])

  // Mark live inbox posts seen once they are on screen (once per id/notified_at).
  useEffect(() => {
    if (tab !== 'inbox') return
    // Deferred so the seen-state write never runs inside the render commit.
    const timer = window.setTimeout(() => {
      for (const a of feed.announcements) if (!a.seen && a.status === 'live') feed.markSeen(a)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [tab, feed])

  useEffect(() => {
    if (focusId == null) return
    const el = document.getElementById(`announcement-${focusId}`)
    el?.scrollIntoView({ block: 'center' })
  }, [focusId, feed.announcements, mine])

  const filteredMine = useMemo(
    () => (statusFilter === 'all' ? mine : mine.filter((a) => a.status === statusFilter)),
    [mine, statusFilter],
  )

  const handleSaved = (saved: ApiAnnouncement) => {
    setMine((prev) =>
      sortAnnouncements(
        prev.some((a) => a.id === saved.id)
          ? prev.map((a) => (a.id === saved.id ? saved : a))
          : [saved, ...prev],
      ),
    )
    void feed.reload()
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteAnnouncement(pendingDelete.id)
      setMine((prev) => prev.filter((a) => a.id !== pendingDelete.id))
      feed.remove(pendingDelete.id)
      setPendingDelete(null)
      setDeleteError(null)
    } catch (err) {
      setDeleteError(userMessage(err, 'Could not delete announcement'))
    }
  }

  const renderList = (rows: ApiAnnouncement[], manage: boolean, emptyText: string) =>
    rows.length === 0 ? (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {emptyText}
      </Typography>
    ) : (
      <Stack spacing={1.5}>
        {rows.map((a) => (
          <AnnouncementCard
            key={a.id}
            announcement={a}
            viewerIsStaff={canCompose}
            manage={manage}
            highlighted={focusId === a.id}
            onToggleReaction={
              manage ? undefined : (ann, emoji) => void feed.toggleReaction(ann, emoji)
            }
            onEdit={manage ? (ann) => setComposer({ mode: 'edit', source: ann }) : undefined}
            onDuplicate={
              manage ? (ann) => setComposer({ mode: 'duplicate', source: ann }) : undefined
            }
            onDelete={manage ? (ann) => setPendingDelete(ann) : undefined}
          />
        ))}
      </Stack>
    )

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h5" component="h1" sx={{ flex: 1 }}>
          Announcements
        </Typography>
        {canCompose && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setComposer({ mode: 'create', source: null })}
          >
            New announcement
          </Button>
        )}
      </Stack>

      {targetsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {targetsError} — the composer's To: list may be incomplete.
        </Alert>
      )}

      {canCompose && (
        <Tabs value={tab} onChange={(_e, v: AnnouncementsTab) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="inbox" label="Inbox" />
          <Tab value="mine" label="Mine" />
        </Tabs>
      )}

      {tab === 'inbox' ? (
        feed.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress aria-label="Loading announcements" />
          </Box>
        ) : feed.error ? (
          <Alert
            severity="error"
            action={<Button onClick={() => void feed.reload()}>Retry</Button>}
          >
            {feed.error}
          </Alert>
        ) : (
          renderList(feed.announcements, false, 'No announcements yet.')
        )
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((f) => (
              <Chip
                key={f}
                label={f === 'all' ? 'All' : ANNOUNCEMENT_STATUS_LABELS[f]}
                color={statusFilter === f ? 'primary' : 'default'}
                variant={statusFilter === f ? 'filled' : 'outlined'}
                onClick={() => setStatusFilter(f)}
                size="small"
              />
            ))}
          </Stack>
          {!mineLoaded && !mineError ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress aria-label="Loading your announcements" />
            </Box>
          ) : mineError ? (
            <Alert severity="error" action={<Button onClick={() => void loadMine()}>Retry</Button>}>
              {mineError}
            </Alert>
          ) : (
            renderList(
              filteredMine,
              true,
              statusFilter === 'all'
                ? "You haven't posted anything yet."
                : `No ${ANNOUNCEMENT_STATUS_LABELS[statusFilter as AnnouncementStatus].toLowerCase()} announcements.`,
            )
          )}
        </>
      )}

      {canCompose && (
        <AnnouncementComposer
          open={activeComposer != null && targetsLoaded}
          onClose={() => {
            setComposer(null)
            if (contextualCompose) onComposeGroupConsumed?.()
          }}
          onSaved={handleSaved}
          initialGroupIds={activeComposer?.groupIds}
          isAdmin={isAdmin}
          programs={programs}
          groups={groups}
          mode={activeComposer?.mode ?? 'create'}
          source={activeComposer?.source ?? null}
        />
      )}

      <Dialog open={pendingDelete != null} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Delete announcement?</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {deleteError}
            </Alert>
          )}
          <Typography>
            “{pendingDelete?.title}” will be removed for everyone, including its reactions. This
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
