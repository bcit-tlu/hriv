import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Box, IconButton, Paper, Stack, Typography } from '@mui/material'
import { Close, Edit, Star, StarBorder } from '@mui/icons-material'
import { fetchBoards, userMessage } from '../api'
import type { ApiBoardSummary, ApiInuksuk } from '../types'

import { inuksukPanelSx } from './inuksukPanelStyles'

export default function InuksukInfoCard({
  item,
  container,
  onClose,
  onEdit,
}: {
  item: ApiInuksuk
  container: HTMLElement
  onClose: () => void
  onEdit: () => void
}) {
  const [boards, setBoards] = useState<ApiBoardSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchBoards().then(
      (rows) => {
        if (!cancelled) {
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
  }, [item.id])
  return createPortal(
    <Paper
      component="section"
      aria-label="Inuksuk information"
      data-hriv-canvas-ui
      elevation={8}
      sx={{ ...inuksukPanelSx, p: 2 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'start', gap: 1 }}>
        <Typography component="h2" variant="h6" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
          {item.title}
        </Typography>
        <IconButton size="small" aria-label="Close Inuksuk information" onClick={onClose}>
          <Close fontSize="small" />
        </IconButton>
      </Box>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {item.description && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {item.description}
          </Typography>
        )}
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {boards
              .filter((board) => item.board_ids.includes(board.id))
              .map((board) => board.name)
              .join(' · ') || (loaded ? 'No visible Boards' : 'Loading Boards…')}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {item.favourite ? (
            <Star color="warning" fontSize="small" />
          ) : (
            <StarBorder fontSize="small" />
          )}
          <Typography variant="body2" sx={{ flex: 1 }}>
            {item.favourite ? 'Favourite' : 'Not a favourite'}
          </Typography>
          {item.permissions.can_edit && (
            <IconButton aria-label={`Edit ${item.title}`} onClick={onEdit}>
              <Edit fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Stack>
    </Paper>,
    container,
  )
}
