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
  /** A retained authoritative server order can still be adopted. */
  serverOrderAvailable?: boolean
  onRetry: () => void
  onAcceptServerOrder: () => void
  onReapplyLocalOrder: () => void
}

/**
 * Compact save-state readout for tile reordering (epic #975, issue #979).
 * Success is only shown once the server has returned the authoritative
 * order and revision.
 */
export default function ReorderStatusIndicator({
  status,
  serverOrderAvailable = false,
  onRetry,
  onAcceptServerOrder,
  onReapplyLocalOrder,
}: ReorderStatusIndicatorProps) {
  if (status === 'idle') return null

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
            <Button size="small" onClick={onReapplyLocalOrder}>
              Keep my order
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
            {serverOrderAvailable && (
              <Button size="small" onClick={onAcceptServerOrder}>
                Use server order
              </Button>
            )}
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
