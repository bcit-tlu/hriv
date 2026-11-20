import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import { fetchBoards } from '../api'
import type { ApiBoardSummary, User } from '../types'
import { ownsBoard } from '../boardUtils'
import BoardCover from './BoardCover'

export interface BoardsPopoverProps {
  /** AppBar button the popover hangs from; `null` closes it. */
  anchorEl: HTMLElement | null
  currentUser: User | null
  onClose: () => void
  onOpenBoard: (boardId: number) => void
  onOpenBoardsPage: () => void
  services?: { fetchBoards: typeof fetchBoards }
}

type Loaded = { boards: ApiBoardSummary[] } | { error: string }

/** Quick AppBar switcher: the viewer's own editable Boards (the Boards &
 *  Markers page row, in its order) open the in-place Board dialog, and the
 *  footer link opens the full page. Boards reload on every open. */
export default function BoardsPopover({
  anchorEl,
  currentUser,
  onClose,
  onOpenBoard,
  onOpenBoardsPage,
  services = { fetchBoards },
}: BoardsPopoverProps) {
  const open = anchorEl != null
  const [loaded, setLoaded] = useState<{ anchor: HTMLElement; value: Loaded } | null>(null)
  const load = services.fetchBoards
  useEffect(() => {
    if (!anchorEl) return
    const controller = new AbortController()
    // Same order as the Boards page row (useBoardsData).
    void load(
      { sort: 'sort_order', order: 'asc', page_size: 200 },
      { signal: controller.signal },
    ).then(
      (boards) => setLoaded({ anchor: anchorEl, value: { boards } }),
      (err: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          anchor: anchorEl,
          value: { error: err instanceof Error ? err.message : 'Could not load Boards.' },
        })
      },
    )
    return () => controller.abort()
  }, [anchorEl, load])
  const value = open && loaded?.anchor === anchorEl ? loaded.value : null
  const boards =
    value && 'boards' in value
      ? value.boards.filter((row) => ownsBoard(row, currentUser) && row.permissions.can_edit)
      : []
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': 'My Boards',
          sx: {
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(560px, calc(100vh - 96px))',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Typography variant="subtitle2" component="h2" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
        My Boards
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {value == null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}>
            <CircularProgress size={24} aria-label="Loading Boards" />
          </Box>
        ) : 'error' in value ? (
          <Alert severity="error" sx={{ m: 1.5 }}>
            {value.error}
          </Alert>
        ) : boards.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            You have no Boards yet.
          </Typography>
        ) : (
          <List dense disablePadding component="div">
            {boards.map((board) => (
              <ListItemButton
                key={board.id}
                onClick={() => onOpenBoard(board.id)}
                sx={{ gap: 1.5, py: 0.75 }}
              >
                <Box sx={{ borderRadius: 1, overflow: 'hidden', flexShrink: 0 }}>
                  <BoardCover board={board} size={48} />
                </Box>
                <ListItemText
                  primary={board.name}
                  secondary={`${board.marker_count} ${board.marker_count === 1 ? 'Marker' : 'Markers'}`}
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
      <Divider />
      {/* Same footer as the Announcements popover. */}
      <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <Button size="small" onClick={onOpenBoardsPage}>
          Open Boards &amp; Markers
        </Button>
      </Box>
    </Popover>
  )
}
