import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import type { AlertColor } from '@mui/material'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import type { ReactNode } from 'react'

import type { TileOrderStatus } from '../tileOrdering'

export interface ReorderStatusIndicatorProps {
  status: TileOrderStatus
  /** Accessible name for the status live region (unique per mounted surface). */
  ariaLabel?: string
  /** A retained authoritative server order can still be adopted. */
  serverOrderAvailable?: boolean
  onRetry: () => void
  onAcceptServerOrder: () => void
  onReapplyLocalOrder: () => void
  /** A scope other than this one holds a failed save. */
  otherScopesFailed?: boolean
  /** Retry the failed saves of every scope, including ones not browsed. */
  onRetryFailedScopes?: () => void
}

/**
 * Compact save-state readout for tile reordering (epic #975, issue #979).
 * Rendered as a filled MUI Alert so it can live inside a Snackbar and share
 * the bottom-right stacking position used by processing/upload notifications.
 */
export default function ReorderStatusIndicator({
  status,
  ariaLabel = 'Reorder save state',
  serverOrderAvailable = false,
  onRetry,
  onAcceptServerOrder,
  onReapplyLocalOrder,
  otherScopesFailed = false,
  onRetryFailedScopes,
}: ReorderStatusIndicatorProps) {
  const crossScope =
    otherScopesFailed && onRetryFailedScopes !== undefined ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <ErrorOutlineIcon fontSize="small" sx={{ color: 'inherit' }} />
        <Typography variant="body2" color="inherit">
          Unresolved order changes in another category
        </Typography>
        <Button size="small" color="inherit" onClick={onRetryFailedScopes}>
          Resolve
        </Button>
      </Box>
    ) : null

  if (status === 'idle' && crossScope === null) return null

  let severity: AlertColor = 'info'
  let icon: ReactNode = undefined
  let mainContent: ReactNode = null

  switch (status) {
    case 'idle':
      severity = 'error'
      icon = <ErrorOutlineIcon fontSize="small" sx={{ color: 'inherit' }} />
      break
    case 'dirty':
    case 'saving':
    case 'dirty-while-saving':
      severity = 'info'
      icon = <CircularProgress size={20} color="inherit" />
      mainContent = (
        <Typography variant="body2" color="inherit">
          Saving order…
        </Typography>
      )
      break
    case 'saved':
      severity = 'success'
      icon = <CheckCircleOutlineIcon fontSize="small" sx={{ color: 'inherit' }} />
      mainContent = (
        <Typography variant="body2" color="inherit">
          Order saved
        </Typography>
      )
      break
    case 'conflict':
      severity = 'warning'
      icon = <SyncProblemIcon fontSize="small" sx={{ color: 'inherit' }} />
      mainContent = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="inherit">
            Order changed elsewhere
          </Typography>
          <Button size="small" color="inherit" onClick={onAcceptServerOrder}>
            Refresh
          </Button>
          <Button size="small" color="inherit" onClick={onReapplyLocalOrder}>
            Keep my order
          </Button>
        </Box>
      )
      break
    case 'error':
      severity = 'error'
      icon = <ErrorOutlineIcon fontSize="small" sx={{ color: 'inherit' }} />
      mainContent = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="inherit">
            Could not save order
          </Typography>
          <Button size="small" color="inherit" onClick={onRetry}>
            Retry
          </Button>
          {serverOrderAvailable && (
            <Button size="small" color="inherit" onClick={onAcceptServerOrder}>
              Use server order
            </Button>
          )}
        </Box>
      )
      break
  }

  return (
    <Alert
      severity={severity}
      variant="filled"
      icon={icon}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      sx={{ alignItems: 'center', width: '100%' }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
        {mainContent}
        {crossScope}
      </Box>
    </Alert>
  )
}
