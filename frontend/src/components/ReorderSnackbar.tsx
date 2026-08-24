import Snackbar from '@mui/material/Snackbar'

import ReorderStatusIndicator, { type ReorderStatusIndicatorProps } from './ReorderStatusIndicator'

export interface ReorderSnackbarProps extends ReorderStatusIndicatorProps {
  /** Position in the bottom-right stack (0 = just above the screen edge). */
  offsetIndex: number
}

/**
 * Bottom-right snackbar for tile-reorder save state.
 *
 * Stacks with the processing/upload snackbars in App.tsx using the same 88 px
 * vertical spacing: pass an `offsetIndex` one greater than the last processing
 * job index so it appears directly above the job stack.
 */
export default function ReorderSnackbar({ offsetIndex, ...indicatorProps }: ReorderSnackbarProps) {
  const open = indicatorProps.status !== 'idle' || indicatorProps.otherScopesFailed

  return (
    <Snackbar
      open={open}
      autoHideDuration={null}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      TransitionProps={{ appear: false }}
      sx={{
        zIndex: 1500,
        bottom: { xs: `${24 + offsetIndex * 88}px !important` },
      }}
    >
      <ReorderStatusIndicator {...indicatorProps} />
    </Snackbar>
  )
}
