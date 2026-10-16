import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Fade from '@mui/material/Fade'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import TrapFocus from '@mui/material/Unstable_TrapFocus'
import type { ReactNode } from 'react'

export interface ViewportDialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * A small dialog centred over the OpenSeadragon viewport. It is not an MUI
 * `Modal`/`Dialog` — those portal to `document.body` with `position: fixed`
 * and would cover the whole page (and vanish in OSD full-page mode). Instead
 * callers render it through `ImageViewer`'s `viewportOverlay` portal, so it
 * lives inside `viewer.container`, absolutely positioned over the image.
 *
 * Focus: the open wraps the content in `Unstable_TrapFocus`, focuses the
 * close button on open, and restores focus to the previously focused
 * element on close. Escape and backdrop clicks close it.
 */
export default function ViewportDialog({ open, title, onClose, children }: ViewportDialogProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const lastFocusedRef = useRef<Element | null>(null)
  const titleId = 'viewport-dialog-title'

  // Track the last element that held focus anywhere in the document — the
  // element focused when the dialog opens is the one to restore to on close.
  // (A listener records it before TrapFocus moves focus into the dialog;
  // recording activeElement in the open effect would be too late.)
  useEffect(() => {
    const record = () => {
      lastFocusedRef.current = document.activeElement
    }
    document.addEventListener('focusin', record)
    return () => document.removeEventListener('focusin', record)
  }, [])

  // Focus the close button on open; return focus to the opener on close.
  // Parent effects run after the child's, so this restore lands after
  // TrapFocus deactivates.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus()
    } else if (lastFocusedRef.current instanceof HTMLElement) {
      lastFocusedRef.current.focus()
    }
  }, [open])

  return (
    <Fade in={open} mountOnEnter unmountOnExit>
      <Box
        role="presentation"
        data-hriv-canvas-ui
        onClick={(e) => {
          // Backdrop click only — clicks on the dialog bubble up with a
          // different target.
          if (e.target === e.currentTarget) onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        // OSD's own pointer/wheel handlers live on the container — keep the
        // dialog's gestures from zooming or panning the image underneath.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(0,0,0,0.5)',
        }}
      >
        <TrapFocus open={open}>
          <Paper
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            elevation={8}
            sx={{
              maxWidth: 'min(560px, 90%)',
              maxHeight: '80%',
              minWidth: 280,
              display: 'flex',
              flexDirection: 'column',
              outline: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                borderBottom: 1,
                borderColor: 'divider',
                flexShrink: 0,
              }}
            >
              <Typography id={titleId} variant="subtitle1" component="h2" noWrap>
                {title}
              </Typography>
              <IconButton
                ref={closeRef}
                size="small"
                aria-label="Close"
                onClick={onClose}
                edge="end"
              >
                <CloseIcon />
              </IconButton>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }} tabIndex={0}>
              {children}
            </Box>
          </Paper>
        </TrapFocus>
      </Box>
    </Fade>
  )
}
