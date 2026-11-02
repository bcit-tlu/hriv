/**
 * Progress + error snackbars for object counting (epic #1661, #1667).
 *
 * Progress: Figma-style bottom-center Paper with an indeterminate
 * LinearProgress along the bottom edge and a Cancel action.
 * Errors: a separate Alert Snackbar — warning severity for
 * too_large/rate_limited/too_many_objects/expired, error otherwise, with a
 * Retry action for timeout/no_tiles/internal. Messages and severities live
 * in `../countingUi`.
 */

import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  activeCountCaption,
  countErrorMessage,
  countErrorRetryable,
  countErrorSeverity,
} from '../countingUi'
import type { SelectionCountEntry } from '../useSelectionCounts'

export interface CountProgressSnackbarProps {
  /** Entries in starting/queued/running phase (any of them). */
  activeEntries: SelectionCountEntry[]
  /** Failed entry whose notice is showing (first failed entry). */
  errorEntry: SelectionCountEntry | null
  onCancelActive: () => void
  onDismissError: (key: string) => void
  onRetry: (entry: SelectionCountEntry) => void
}

export default function CountProgressSnackbar({
  activeEntries,
  errorEntry,
  onCancelActive,
  onDismissError,
  onRetry,
}: CountProgressSnackbarProps) {
  const many = activeEntries.length > 1

  return (
    <>
      <Snackbar
        open={activeEntries.length > 0}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 16, sm: 28 } }}
      >
        <Paper
          elevation={8}
          role="status"
          aria-live="polite"
          data-hriv-canvas-ui
          sx={{ width: { xs: 320, sm: 390 }, overflow: 'hidden' }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.5 }}>
            <AutoAwesomeOutlinedIcon color="primary" />
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Counting objects
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {activeEntries.length === 0
                  ? ''
                  : many
                    ? `Counting objects in ${activeEntries.length} selections`
                    : activeCountCaption(activeEntries[0])}
              </Typography>
            </Box>
            <Button size="small" onClick={onCancelActive}>
              Cancel
            </Button>
          </Stack>
          <LinearProgress aria-label="Counting in progress" />
        </Paper>
      </Snackbar>

      <Snackbar
        open={errorEntry != null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 16, sm: 28 } }}
      >
        {errorEntry ? (
          <Alert
            severity={countErrorSeverity(errorEntry.error ?? 'internal')}
            variant="standard"
            onClose={() => onDismissError(errorEntry.key)}
            data-hriv-canvas-ui
            action={
              errorEntry.error != null && countErrorRetryable(errorEntry.error) ? (
                <Button color="inherit" size="small" onClick={() => onRetry(errorEntry)}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {countErrorMessage(errorEntry.error ?? 'internal')}
          </Alert>
        ) : (
          <Box />
        )}
      </Snackbar>
    </>
  )
}
