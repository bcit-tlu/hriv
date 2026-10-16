import { useLayoutEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'

export interface ClampedContentProps {
  /** Rendered inside the line-clamped box. */
  children: ReactNode
  /** Popover body; defaults to `children`. */
  fullContent?: ReactNode
  /** Lines to clamp to. */
  lines?: number
  /** Preserve newlines in the popover body (notes). */
  preWrap?: boolean
  /** Heading shown at the top of the popover. */
  popoverHeading: string
  /** Accessible name for the "more" link (the visible text is just "more"). */
  moreAriaLabel: string
  /** Layout of the outer clamp Box (flex/minWidth comes from the caller). */
  sx?: SxProps<Theme>
}

/**
 * Line-clamped content with an "…more" affordance. When the content overflows,
 * an overlay at the end of the last visible line covers the native ellipsis
 * and opens a body-portaled Popover with the full content. Links clipped below
 * the fold — or covered by the overlay — are removed from the tab order.
 */
export default function ClampedContent({
  children,
  fullContent,
  lines = 2,
  preWrap = false,
  popoverHeading,
  moreAriaLabel,
  sx,
}: ClampedContentProps) {
  const [clampEl, setClampEl] = useState<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  useLayoutEffect(() => {
    const el = clampEl
    if (!el) return
    const measure = () => {
      setOverflowing(el.scrollHeight > el.clientHeight + 1)
      // Links clipped below the fold of the clamp must leave the tab order.
      // getClientRects() gives one rect per line fragment, so a link that
      // wraps stays tabbable while part of it is visible. An empty list
      // (jsdom) means we can't measure, so the node stays tabbable too.
      const fold = el.getBoundingClientRect().top + el.clientHeight
      const overlay = el.querySelector('[data-info-more]')?.parentElement
      const overlayRect = overlay?.getBoundingClientRect()
      for (const node of el.querySelectorAll<HTMLElement>('a[href], button')) {
        if (node.hasAttribute('data-info-more')) continue
        const fragments = [...node.getClientRects()]
        const hidden =
          fragments.length > 0 &&
          fragments.every(
            (f) =>
              f.top >= fold ||
              // Covered by the "…more" overlay on the last visible line.
              (overlayRect != null && f.right > overlayRect.left && f.bottom > overlayRect.top),
          )
        if (hidden) node.setAttribute('tabindex', '-1')
        else node.removeAttribute('tabindex')
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // `overflowing` is a dep so measure re-runs once the overlay renders.
  }, [children, overflowing, clampEl])

  return (
    <>
      <Box
        ref={setClampEl}
        sx={[
          {
            typography: 'body2',
            color: 'text.secondary',
            position: 'relative',
            display: '-webkit-box',
            WebkitLineClamp: lines,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            // Long unbroken strings wrap so the clamp — and "…more" — engage.
            overflowWrap: 'anywhere',
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {children}
        {overflowing && (
          // Covers the native line-clamp ellipsis so the reader sees
          // "…more" right after the cut-off text.
          <Box
            component="span"
            sx={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              bgcolor: 'background.default',
              pl: 0.5,
              typography: 'body2',
            }}
          >
            …
            <Link
              component="button"
              type="button"
              variant="body2"
              underline="hover"
              data-info-more
              aria-label={moreAriaLabel}
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
              onClick={() => setPopoverOpen(true)}
            >
              more
            </Link>
          </Box>
        )}
      </Box>
      <Popover
        open={popoverOpen}
        anchorEl={clampEl}
        onClose={() => setPopoverOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box
          sx={{ maxWidth: 480, maxHeight: '50vh', overflow: 'auto', p: 2 }}
          // A link inside the popover also closes it.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, button')) setPopoverOpen(false)
          }}
        >
          <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
            {popoverHeading}
          </Typography>
          <Box
            sx={{
              typography: 'body2',
              color: 'text.secondary',
              overflowWrap: 'anywhere',
              ...(preWrap ? { whiteSpace: 'pre-wrap' } : {}),
            }}
          >
            {fullContent ?? children}
          </Box>
        </Box>
      </Popover>
    </>
  )
}
