import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'

import type { TileOrderStatus } from '../tileOrdering'

export interface ReorderStatusIndicatorProps {
  status: TileOrderStatus
  onRetry: () => void
  onAcceptServerOrder: () => void
  /** A scope other than the browsed one holds a failed save. */
  otherScopesFailed?: boolean
  /** Retry the failed saves of every scope, including ones not browsed. */
  onRetryFailedScopes?: () => void
}

/**
 * Compact save-state readout for tile reordering (epic #975, issue #979).
 * Success is only shown once the server has returned the authoritative
 * order and revision.
 */
export default function ReorderStatusIndicator({
  status,
  onRetry,
  onAcceptServerOrder,
  otherScopesFailed = false,
  onRetryFailedScopes,
}: ReorderStatusIndicatorProps) {
  // A failed save or unresolved conflict in a category the user has
  // navigated away from is otherwise invisible and unrecoverable, while
  // still arming the unload guard.
  if (status === 'idle') {
    if (!otherScopesFailed) return null
    return (
      <Box
        role="status"
        aria-label="Reorder save state"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 28 }}
      >
        <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />
        <Typography variant="caption">Unresolved order changes in another category</Typography>
        <Button size="small" onClick={onRetryFailedScopes}>
          Resolve
        </Button>
      </Box>
    )
  }

  const content = (() => {
    switch (status) {
      case 'dirty':
        return <Typography variant="caption">Unsaved order</Typography>
      case 'saving':
      case 'dirty-while-saving':
        return (
          <>
            <CircularProgress size={14} />
            <Typography variant="caption">Saving order…</Typography>
          </>
        )
      case 'saved':
        return (
          <>
            <CheckCircleOutlineIcon color="success" sx={{ fontSize: 16 }} />
            <Typography variant="caption">Order saved</Typography>
          </>
        )
      case 'conflict':
        return (
          <>
            <SyncProblemIcon color="warning" sx={{ fontSize: 16 }} />
            <Typography variant="caption">Order changed elsewhere</Typography>
            <Button size="small" onClick={onAcceptServerOrder}>
              Refresh
            </Button>
          </>
        )
      case 'error':
        return (
          <>
            <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />
            <Typography variant="caption">Could not save order</Typography>
            <Button size="small" onClick={onRetry}>
              Retry
            </Button>
          </>
        )
    }
  })()

  return (
    <Box
      role="status"
      aria-label="Reorder save state"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 28 }}
    >
      {content}
    </Box>
  )
}
