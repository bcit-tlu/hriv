/**
 * "Learn more about object counting" dialog (epic #1661).
 *
 * Renders `guide/object-counting.md` through the existing guide renderer.
 * The page is deliberately NOT registered in `GUIDE_PAGES` — the feature is
 * dark-launched, so the guide page is reachable only from the counting UI.
 * Opens in place rather than navigating away, because count results are
 * ephemeral and would be destroyed.
 */

import CloseIcon from '@mui/icons-material/Close'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'

import { getGuideMarkdown } from '../guideContent'
import GuideMarkdown from './guideMarkdown'

export default function CountHelpDialog({
  open,
  onClose,
  container,
}: {
  open: boolean
  onClose: () => void
  /** Mount node — pass the OSD container to survive full-page mode. */
  container?: HTMLElement | (() => HTMLElement)
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      container={container}
      aria-labelledby="count-help-title"
    >
      <DialogTitle
        id="count-help-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        Object counting
        <IconButton aria-label="Close help" onClick={onClose} sx={{ mr: -1 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <GuideMarkdown
          markdown={getGuideMarkdown('object-counting')}
          images={{}}
          onNavigate={() => {
            // Standalone page (not in GUIDE_PAGES): nowhere to navigate to.
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
