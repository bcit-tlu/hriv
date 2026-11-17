import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Box, Button, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { CompassCalibration, Edit, Star, StarBorder } from '@mui/icons-material'
import { ApiError, fetchBoards, fetchInuksuk, updateInuksuk, userMessage } from '../api'
import type { ApiBoardSummary, ApiInuksuk } from '../types'

import { inuksukPanelSx } from './inuksukPanelStyles'
import InuksukFormDialog from './InuksukFormDialog'

export default function InuksukInfoCard({
  item,
  container,
  onClose,
  onEdit,
  editing = false,
  initialDelete = false,
  userId,
  onCancelEdit,
  onChanged,
}: {
  item: ApiInuksuk
  container: HTMLElement
  onClose: () => void
  onEdit: (item: ApiInuksuk) => void
  editing?: boolean
  initialDelete?: boolean
  userId?: number
  onCancelEdit?: () => void
  onChanged?: () => Promise<void> | void
}) {
  const cardRef = useRef<HTMLElement>(null)
  const [boards, setBoards] = useState<ApiBoardSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [savedItem, setSavedItem] = useState<ApiInuksuk | null>(null)
  const [busy, setBusy] = useState(false)
  const [favouriteError, setFavouriteError] = useState<string | null>(null)
  const [favouriteConflict, setFavouriteConflict] = useState(false)
  const current = savedItem?.id === item.id && savedItem.version > item.version ? savedItem : item
  const changeFavourite = async (reload = false) => {
    setBusy(true)
    setFavouriteError(null)
    try {
      const updated = reload
        ? await fetchInuksuk(current.id)
        : await updateInuksuk(current.id, {
            version: current.version,
            favourite: !current.favourite,
          })
      setSavedItem(updated)
      setFavouriteConflict(false)
      await onChanged?.()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFavouriteConflict(true)
        setFavouriteError('This Inuksuk changed. Reload current values before trying again.')
      } else
        setFavouriteError(
          userMessage(err, reload ? 'Unable to reload Inuksuk.' : 'Unable to change favourite.'),
        )
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const document = container.ownerDocument
    const outside = (event: PointerEvent) => {
      if (!editing && event.target instanceof Node && !cardRef.current?.contains(event.target))
        onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (!editing && event.key === 'Escape' && !event.defaultPrevented) {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [container, editing, onClose])
  useEffect(() => {
    if (editing) return
    let cancelled = false
    fetchBoards().then(
      (rows) => {
        if (!cancelled) {
          setError(null)
          setBoards(rows)
          setLoaded(true)
        }
      },
      (err) => {
        if (!cancelled) setError(userMessage(err, 'Unable to load Board names.'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [item.id, editing])
  return createPortal(
    <Paper
      ref={cardRef}
      component="section"
      aria-label="Inuksuk information"
      data-hriv-canvas-ui
      elevation={8}
      sx={{ ...inuksukPanelSx, p: 1.5 }}
    >
      {editing && current.permissions.can_edit ? (
        <InuksukFormDialog
          key={item.id}
          inline
          imageId={item.image_id}
          item={current}
          view={item}
          userId={userId}
          container={container}
          initialDelete={initialDelete}
          onChanged={() => onChanged?.()}
          onClose={onCancelEdit ?? onClose}
          onEscape={onClose}
        />
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
              <CompassCalibration color="primary" fontSize="small" />
              <Typography
                component="h2"
                variant="subtitle2"
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {current.title}
              </Typography>
              {current.permissions.can_edit && (
                <Tooltip title="Edit Inuksuk">
                  <IconButton
                    size="small"
                    aria-label={`Edit ${current.title}`}
                    disabled={busy || favouriteConflict}
                    onClick={() => onEdit(current)}
                    sx={{ flexShrink: 0 }}
                  >
                    <Edit fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {current.permissions.can_edit ? (
              <Tooltip title={current.favourite ? 'Remove favourite' : 'Add favourite'}>
                <IconButton
                  size="small"
                  aria-label="Favourite"
                  aria-pressed={current.favourite}
                  disabled={busy || favouriteConflict}
                  onClick={() => void changeFavourite()}
                  color={current.favourite ? 'primary' : 'default'}
                >
                  {current.favourite ? <Star fontSize="small" /> : <StarBorder fontSize="small" />}
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title={current.favourite ? 'Favourite' : 'Not favourited'}>
                <Box
                  component="span"
                  role="img"
                  aria-label={current.favourite ? 'Favourite' : 'Not favourited'}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  {current.favourite ? (
                    <Star color="warning" fontSize="small" />
                  ) : (
                    <StarBorder fontSize="small" />
                  )}
                </Box>
              </Tooltip>
            )}
          </Box>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {favouriteError && (
              <Alert
                severity="error"
                action={
                  favouriteConflict ? (
                    <Button
                      size="small"
                      color="inherit"
                      disabled={busy}
                      onClick={() => void changeFavourite(true)}
                    >
                      Reload current
                    </Button>
                  ) : undefined
                }
              >
                {favouriteError}
              </Alert>
            )}
            {current.description && (
              <Typography
                variant="caption"
                component="p"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {current.description}
              </Typography>
            )}
            {error ? (
              <Alert severity="error">{error}</Alert>
            ) : (
              <Typography variant="caption" component="p" color="text.secondary">
                {boards
                  .filter((board) => current.board_ids.includes(board.id))
                  .map((board) => board.name)
                  .join(' · ') || (loaded ? 'No visible Boards' : 'Loading Boards…')}
              </Typography>
            )}
          </Stack>
        </>
      )}
    </Paper>,
    container,
  )
}
