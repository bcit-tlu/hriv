import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { Edit, Star, StarBorder } from '@mui/icons-material'
import { fetchBoards, userMessage } from '../api'
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
  onEdit: () => void
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
      {editing && item.permissions.can_edit ? (
        <InuksukFormDialog
          key={item.id}
          inline
          imageId={item.image_id}
          item={item}
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
            <Typography
              component="h2"
              variant="subtitle2"
              sx={{ flex: 1, overflowWrap: 'anywhere' }}
            >
              {item.title}
            </Typography>
            <Tooltip title={item.favourite ? 'Favourite' : 'Not favourited'}>
              <Box
                component="span"
                role="img"
                aria-label={item.favourite ? 'Favourite' : 'Not favourited'}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                {item.favourite ? (
                  <Star color="warning" fontSize="small" />
                ) : (
                  <StarBorder fontSize="small" />
                )}
              </Box>
            </Tooltip>
          </Box>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {item.description && (
              <Typography
                variant="caption"
                component="p"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {item.description}
              </Typography>
            )}
            {error ? (
              <Alert severity="error">{error}</Alert>
            ) : (
              <Typography variant="caption" component="p" color="text.secondary">
                {boards
                  .filter((board) => item.board_ids.includes(board.id))
                  .map((board) => board.name)
                  .join(' · ') || (loaded ? 'No visible Boards' : 'Loading Boards…')}
              </Typography>
            )}
            {item.permissions.can_edit && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <IconButton size="small" aria-label={`Edit ${item.title}`} onClick={onEdit}>
                  <Edit fontSize="small" />
                </IconButton>
              </Box>
            )}
          </Stack>
        </>
      )}
    </Paper>,
    container,
  )
}
