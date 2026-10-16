import { useLayoutEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'

export interface ClampedContentProps {
  /** Rendered inside the line-clamped box. */
  children: ReactNode
  /** Lines to clamp to. */
  lines?: number
  /** Called when the "…more" affordance is clicked — callers open a dialog. */
  onMore: () => void
  /** Whether the caller's full-content dialog is open (aria-expanded). */
  expanded?: boolean
  /** Accessible name for the "more" link (the visible text is just "more"). */
  moreAriaLabel: string
  /** Layout of the outer clamp Box (flex/minWidth comes from the caller). */
  sx?: SxProps<Theme>
}

/**
 * Line-clamped content with an "…more" affordance. When the content overflows,
 * an overlay at the end of the last visible line covers the native ellipsis
 * and calls `onMore` (callers open the full content in a dialog). Links
 * clipped below the fold — or covered by the overlay — are removed from the
 * tab order.
 */
export default function ClampedContent({
  children,
  lines = 2,
  onMore,
  expanded = false,
  moreAriaLabel,
  sx,
}: ClampedContentProps) {
  const [clampEl, setClampEl] = useState<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const singleLine = lines === 1

  useLayoutEffect(() => {
    const el = clampEl
    if (!el) return
    const measure = () => {
      // A 1-line clamp is a nowrap ellipsis: it overflows horizontally.
      setOverflowing(
        singleLine ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1,
      )
      // Links clipped below the fold of the clamp must leave the tab order.
      // getClientRects() gives one rect per line fragment, so a link that
      // wraps stays tabbable while part of it is visible. An empty list
      // (jsdom) means we can't measure, so the node stays tabbable too.
      const elRect = el.getBoundingClientRect()
      const fold = elRect.top + el.clientHeight
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
              // Past the right edge of a 1-line clamp.
              f.left >= elRect.right ||
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
  }, [children, overflowing, clampEl, singleLine])

  return (
    <Box
      ref={setClampEl}
      sx={[
        {
          typography: 'body2',
          color: 'text.secondary',
          position: 'relative',
          overflow: 'hidden',
          // One line clamps with a nowrap ellipsis that reaches the right
          // edge — where the "…more" overlay sits — instead of the native
          // line-clamp ellipsis, which lands mid-text.
          ...(singleLine
            ? { display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }
            : {
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                // Long unbroken strings wrap so the clamp — and "…more" — engage.
                overflowWrap: 'anywhere',
              }),
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
            aria-expanded={expanded}
            onClick={onMore}
          >
            more
          </Link>
        </Box>
      )}
    </Box>
  )
}
