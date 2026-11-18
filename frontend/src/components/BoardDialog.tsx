import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import Close from '@mui/icons-material/Close'
import Edit from '@mui/icons-material/Edit'
import Room from '@mui/icons-material/Room'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import SwapHoriz from '@mui/icons-material/SwapHoriz'
import { alpha } from '@mui/material/styles'
import { ApiError, fetchBoard, fetchMarker, updateMarker, userMessage } from '../api'
import type { ApiBoard, ApiMarker, Group, Program, User } from '../types'
import { boardManagerText } from '../boardUtils'
import { CollectionVisibilityChip } from './CollectionCard'
import BoardEditDialog from './BoardEditDialog'
import BoardOwnersDialog from './BoardOwnersDialog'
import MarkerFormDialog from './MarkerFormDialog'
import RenewingThumbnail from './RenewingThumbnail'

export interface BoardDialogProps {
  /** Board to show; `null` keeps the dialog closed. */
  boardId: number | null
  currentUser: User | null
  programs?: Program[]
  groups?: Group[]
  /** Portal host — the opening viewer's container keeps the dialog
   * visible in full-page mode; defaults to the body portal. */
  container?: HTMLElement | null
  onClose: () => void
  /** Navigates to the marker's saved view — the parent closes this dialog. */
  onOpenMarker: (item: ApiMarker) => void
  /** Opens the full management surface on Boards & Markers. */
  onManage?: (boardId: number) => void
  /** Board or Marker data changed — lets the mounted viewer refresh its rows. */
  onChanged?: () => void
}

/**
 * In-place Board view used from the image viewer's Markers drawer: the Board
 * opens over the current image instead of navigating to Boards & Markers.
 * Marker tiles still navigate to their saved views, and Board details/owners
 * stay editable; the heavier management flows (reorder, move, selection,
 * Collections) remain on the Boards & Markers page via `onManage`.
 */
export default function BoardDialog({
  boardId,
  currentUser,
  programs,
  groups,
  container,
  onClose,
  onOpenMarker,
  onManage,
  onChanged,
}: BoardDialogProps) {
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('sm'))
  const generation = useRef(0)
  const [state, setState] = useState<{
    id: number
    board: ApiBoard | null
    error: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [edit, setEdit] = useState(false)
  const [owners, setOwners] = useState(false)
  const [editingItem, setEditingItem] = useState<ApiMarker | null>(null)

  const load = useCallback(async () => {
    const token = ++generation.current
    if (boardId == null) return false
    try {
      const board = await fetchBoard(boardId)
      if (token === generation.current) setState({ id: boardId, board, error: null })
      return true
    } catch (err) {
      if (token === generation.current)
        setState((previous) => ({
          id: boardId,
          board: previous?.id === boardId ? previous.board : null,
          error: userMessage(err, 'Unable to load Board.'),
        }))
      return false
    }
  }, [boardId])
  useEffect(() => {
    const counter = generation
    void load()
    return () => {
      counter.current++
    }
  }, [load])
  // Reload-latest recovery: only a successful fetch clears the 409 block.
  const reloadLatest = async () => {
    if (await load()) {
      setError(null)
      setConflict(false)
    }
  }

  // Reset sub-dialog state when a different Board is targeted.
  const [appliedBoardId, setAppliedBoardId] = useState(boardId)
  if (appliedBoardId !== boardId) {
    setAppliedBoardId(boardId)
    setEdit(false)
    setOwners(false)
    setEditingItem(null)
    setBusy(false)
    setError(null)
    setConflict(false)
  }

  const board = state?.id === boardId ? state.board : null
  const boardError = state?.id === boardId ? state.error : null
  const loading = boardId != null && state?.id !== boardId

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setConflict(false)
    try {
      await action()
      await load()
      onChanged?.()
      return true
    } catch (err) {
      setConflict(err instanceof ApiError && err.status === 409)
      setError(userMessage(err, 'Unable to save changes.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const favouriteAction = (item: ApiMarker) => {
    if (!item.permissions.can_edit)
      return item.favourite ? (
        <Box
          component="span"
          role="img"
          aria-label={`Favourite ${item.title}`}
          sx={{ display: 'inline-flex', p: 0.5, borderRadius: '50%', bgcolor: 'primary.main' }}
        >
          <Star sx={{ color: 'common.white' }} fontSize="small" />
        </Box>
      ) : null
    return (
      <Tooltip title="Favourite">
        <IconButton
          size="small"
          aria-label={`Favourite ${item.title}`}
          aria-pressed={item.favourite}
          sx={
            item.favourite
              ? { bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }
              : undefined
          }
          disabled={busy || conflict}
          onClick={(event) => {
            event.stopPropagation()
            void run(() =>
              updateMarker(item.id, { version: item.version, favourite: !item.favourite }),
            )
          }}
        >
          {item.favourite ? (
            <Star sx={{ color: 'common.white' }} fontSize="small" />
          ) : (
            <StarBorder fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
    )
  }

  const markerCard = (item: ApiMarker) => (
    <Card
      key={item.id}
      elevation={2}
      data-testid="marker-card"
      sx={{ position: 'relative', height: '100%' }}
    >
      <Box sx={{ position: 'relative' }}>
        <CardActionArea
          onClick={() => onOpenMarker(item)}
          aria-label={`Open Marker: ${item.title}`}
        >
          {item.thumb ? (
            <RenewingThumbnail
              image={{ id: item.id, thumb: item.thumb }}
              renewThumb={fetchMarker}
              alt=""
              sx={{ width: '100%', height: 96, display: 'block', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                height: 96,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <Room sx={{ fontSize: 48 }} />
            </Box>
          )}
        </CardActionArea>
        <Box
          sx={(theme) => ({
            position: 'absolute',
            top: 4,
            right: 4,
            display: 'flex',
            gap: 0.5,
            '& .MuiIconButton-root': {
              color: theme.palette.common.white,
              bgcolor: alpha(theme.palette.common.black, 0.25),
              '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.45) },
            },
          })}
        >
          {favouriteAction(item)}
        </Box>
      </Box>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="flex-start" gap={0.5}>
          <Room color="primary" sx={{ fontSize: 24, flexShrink: 0 }} />
          <Button
            onClick={() => onOpenMarker(item)}
            title={item.title}
            sx={{
              p: 0,
              minWidth: 0,
              flex: 1,
              textTransform: 'none',
              justifyContent: 'flex-start',
              textAlign: 'left',
            }}
          >
            <Typography
              component="h3"
              variant="body2"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
            >
              {item.title}
            </Typography>
          </Button>
          {(item.permissions.can_edit || board?.permissions.can_edit) && (
            <Tooltip title="Edit Marker">
              <IconButton
                size="small"
                aria-label={`Edit Marker: ${item.title}`}
                disabled={busy || conflict}
                onClick={() => {
                  setError(null)
                  setEditingItem(item)
                }}
              >
                <Edit sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          title={item.category_name ?? 'Uncategorized'}
        >
          {item.category_name ?? 'Uncategorized'}
        </Typography>
      </CardContent>
    </Card>
  )

  return (
    <>
      <Dialog
        open={boardId != null}
        onClose={onClose}
        container={container ?? undefined}
        fullScreen={mobile}
        fullWidth
        maxWidth="lg"
        aria-labelledby="board-dialog-title"
        slotProps={{ paper: { sx: { height: { xs: '100%', sm: '85vh' } } } }}
      >
        <DialogTitle
          id="board-heading"
          component="div"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
              <Typography
                id="board-dialog-title"
                component="h2"
                variant="h6"
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {board?.name ?? 'Board'}
              </Typography>
              {board && (
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: 0.5 }}
                >
                  ({board.marker_count} Markers)
                </Typography>
              )}
              {board?.permissions.can_edit && (
                <IconButton
                  size="small"
                  aria-label="Edit Board"
                  disabled={busy || conflict}
                  onClick={() => setEdit(true)}
                >
                  <Edit sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
            {onManage && boardId != null && (
              <Button variant="outlined" size="small" onClick={() => onManage(boardId)}>
                Open in Boards &amp; Markers
              </Button>
            )}
            <IconButton aria-label="Close Board" onClick={onClose}>
              <Close />
            </IconButton>
          </Stack>
          {board && (
            <>
              <Box
                role="group"
                aria-label="Board scope and owners"
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1,
                  mt: 1,
                }}
              >
                <CollectionVisibilityChip visibility={board.visibility} />
                <Box sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {boardManagerText(board)}
                  </Typography>
                  {board.permissions.can_transfer && (
                    <Tooltip title="Manage owners">
                      <IconButton
                        size="small"
                        aria-label="Manage owners"
                        disabled={busy || conflict}
                        sx={{ ml: 0.25, p: 0.25 }}
                        onClick={() => setOwners(true)}
                      >
                        <SwapHoriz fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
              {board.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1, maxHeight: 72, overflowY: 'auto' }}
                >
                  {board.description}
                </Typography>
              )}
            </>
          )}
        </DialogTitle>
        <DialogContent sx={{ pt: '16px !important' }}>
          {(error || boardError) && (
            <Alert
              severity="error"
              action={<Button onClick={() => void reloadLatest()}>Reload latest</Button>}
            >
              {error || boardError}
            </Alert>
          )}
          {loading && <CircularProgress aria-label="Loading Board" size={24} />}
          {board && (
            <>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 234px)', gap: 2 }}
              >
                {board.markers.map((item) => markerCard(item))}
              </Box>
              {!board.markers.length && (
                <Typography color="text.secondary">
                  No Markers yet. Save a view from an image.
                </Typography>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {edit && board && (
        <BoardEditDialog
          board={board}
          programs={programs}
          groups={groups}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false)
            void load()
            onChanged?.()
          }}
          onDeleted={() => {
            onChanged?.()
            onClose()
          }}
        />
      )}
      {owners && board && (
        <BoardOwnersDialog
          board={board}
          programs={programs}
          onClose={() => setOwners(false)}
          onSaved={() => {
            void load()
            onChanged?.()
          }}
        />
      )}
      {editingItem && (
        <MarkerFormDialog
          item={editingItem}
          imageId={editingItem.image_id}
          view={editingItem}
          container={container}
          userId={currentUser?.id}
          onClose={() => setEditingItem(null)}
          onChanged={() => {
            void load()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}
