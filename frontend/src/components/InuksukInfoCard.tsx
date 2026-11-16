import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
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
      sx={{ ...inuksukPanelSx, p: 1.5 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography component="h2" variant="subtitle2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
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
        <IconButton size="small" aria-label="Close Inuksuk information" onClick={onClose}>
          <Close fontSize="small" />
        </IconButton>
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
    </Paper>,
    container,
  )
}
