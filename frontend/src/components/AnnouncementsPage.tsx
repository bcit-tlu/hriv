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
import { mergeStreams, type ComposerMode } from '../announcementUtils'

export type AnnouncementsFilter = AnnouncementStatus | 'all' | 'mine'

export interface AnnouncementsPageProps {
  currentUser: User
  /** Shared inbox feed (same instance as the bell). */
  feed: UseAnnouncementsResult
  /** Admin/instructor/staff: adds the author scope, filters, "New announcement" and seen counts. */
  canCompose: boolean
  /** Deep link `?page=announcements&id=…`: scroll to and highlight one card. */
  focusId?: number | null
  /** Contextual compose ("Post to group"): open the composer with this group pre-selected. */
  composeGroupId?: number | null
  onComposeGroupConsumed?: () => void
}

const FILTERS: Array<{ id: AnnouncementsFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'My announcements' },
  { id: 'draft', label: ANNOUNCEMENT_STATUS_LABELS.draft },
  { id: 'scheduled', label: ANNOUNCEMENT_STATUS_LABELS.scheduled },
  { id: 'live', label: ANNOUNCEMENT_STATUS_LABELS.live },
  { id: 'expired', label: ANNOUNCEMENT_STATUS_LABELS.expired },
]

const EMPTY_TEXT: Record<AnnouncementsFilter, string> = {
  all: 'No announcements yet.',
  mine: "You haven't posted anything yet.",
  draft: 'No draft announcements.',
  scheduled: 'No scheduled announcements.',
  live: 'No live announcements.',
  expired: 'No expired announcements.',
}

export default function AnnouncementsPage({
  currentUser,
  feed,
  canCompose,
  focusId = null,
  composeGroupId = null,
  onComposeGroupConsumed,
}: AnnouncementsPageProps) {
  const isAdmin = currentUser.role === 'admin'
  const [mine, setMine] = useState<ApiAnnouncement[]>([])
  const [mineLoaded, setMineLoaded] = useState(!canCompose)
  const [mineError, setMineError] = useState<string | null>(null)
  const [filter, setFilter] = useState<AnnouncementsFilter>('all')
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
    if (canCompose) void loadMine()
  }, [canCompose, loadMine])

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
    // Deferred so the seen-state write never runs inside the render commit.
    const timer = window.setTimeout(() => {
      for (const a of feed.announcements) if (!a.seen && a.status === 'live') feed.markSeen(a)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [feed])

  const rows = useMemo(() => mergeStreams(feed.announcements, mine), [feed.announcements, mine])

  useEffect(() => {
    if (focusId == null) return
    const el = document.getElementById(`announcement-${focusId}`)
    el?.scrollIntoView({ block: 'center' })
  }, [focusId, rows])

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'mine') return rows.filter((a) => a.author_id === currentUser.id)
    return rows.filter((a) => a.status === filter)
  }, [rows, filter, currentUser.id])

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

  const loading = feed.loading || (canCompose && !mineLoaded && !mineError)
  const error = feed.error ?? mineError
  const retry = () => {
    if (feed.error) void feed.reload()
    if (mineError) void loadMine()
  }

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
        <Stack
          direction="row"
          spacing={1}
          role="group"
          aria-label="Filter announcements"
          sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              color={filter === f.id ? 'primary' : 'default'}
              variant={filter === f.id ? 'filled' : 'outlined'}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              size="small"
            />
          ))}
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading announcements" />
        </Box>
      ) : error ? (
        <Alert severity="error" action={<Button onClick={retry}>Retry</Button>}>
          {error}
        </Alert>
      ) : visibleRows.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {EMPTY_TEXT[filter]}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {visibleRows.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              viewerIsStaff={canCompose}
              manage={canCompose}
              highlighted={focusId === a.id}
              onToggleReaction={(ann, emoji) => void feed.toggleReaction(ann, emoji)}
              onEdit={canCompose ? (ann) => setComposer({ mode: 'edit', source: ann }) : undefined}
              onDuplicate={
                canCompose ? (ann) => setComposer({ mode: 'duplicate', source: ann }) : undefined
              }
              onDelete={canCompose ? (ann) => setPendingDelete(ann) : undefined}
            />
          ))}
        </Stack>
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
