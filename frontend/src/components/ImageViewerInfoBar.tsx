import { useLayoutEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export interface ImageViewerInfoBarProps {
  /** Cells are keyed on this so overflow/popover state resets per image. */
  imageId: number
  note?: string | null
  /** App passes <ImageCollectionsList …/> or null. Rendered both in the clamped
   *  cell and (again) inside the popover — rendering the same element twice is
   *  intentional. */
  collections?: ReactNode
}

interface InfoCellProps {
  label: string
  children: ReactNode
  /** Preserve newlines (notes) in the popover body. */
  preWrap?: boolean
  /**
   * What the popover shows; defaults to `children`. The note cell flattens
   * newlines for the clamp so "…more" sits right after the cut-off text,
   * while the popover keeps the original `pre-wrap` text.
   */
  fullContent?: ReactNode
  /** Accessible name for the "more" link (the visible text is just "more"). */
  moreAriaLabel: string
}

/**
 * One info-bar cell: label on the left, value clamped to two lines on the
 * right. When the value overflows, an "…more" link overlaid at the end of the
 * second line opens a Popover with the full content (body-portaled — the bar
 * lives outside OSD).
 */
function InfoCell({ label, children, preWrap = false, fullContent, moreAriaLabel }: InfoCellProps) {
  const [cellEl, setCellEl] = useState<HTMLDivElement | null>(null)
  const valueRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  useLayoutEffect(() => {
    const el = valueRef.current
    if (!el) return
    const measure = () => {
      setOverflowing(el.scrollHeight > el.clientHeight + 1)
      // Links clipped below the fold of the clamp must leave the tab order.
      // Their offsetParent is this Box (it is position: relative).
      for (const node of el.querySelectorAll<HTMLElement>('a[href], button')) {
        if (node.hasAttribute('data-info-more')) continue
        if (node.offsetTop >= el.clientHeight) node.setAttribute('tabindex', '-1')
        else node.removeAttribute('tabindex')
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children])

  return (
    <>
      <Box ref={setCellEl} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            component="div"
            sx={{ whiteSpace: 'nowrap' }}
          >
            <strong>{label}</strong>
          </Typography>
        </Box>
        <Box
          ref={valueRef}
          sx={{
            flex: 1,
            minWidth: 0,
            typography: 'body2',
            color: 'text.secondary',
            position: 'relative',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            // Long unbroken strings wrap so the clamp — and "…more" — engage.
            overflowWrap: 'anywhere',
          }}
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
      </Box>
      <Popover
        open={popoverOpen}
        anchorEl={cellEl}
        onClose={() => setPopoverOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box
          sx={{ maxWidth: 480, maxHeight: '50vh', overflow: 'auto', p: 2 }}
          // A collection link inside the popover also closes it.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, button')) setPopoverOpen(false)
          }}
        >
          <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
            {label.replace(/:$/, '')}
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

/**
 * Always-visible info row below the regular image viewer (#1677): Notes and
 * Collections side by side at `md`+ in a 3fr 2fr split (notes get priority; a
 * lone cell spans the full width), stacking below `md`. Each value is clamped
 * to two lines with an "…more" popover for the full content. Renders nothing
 * when both are absent — the viewer instructions now live in the
 * ImageDetailsDrawer footer. No background: the bar sits directly on the page.
 */
export default function ImageViewerInfoBar({
  imageId,
  note,
  collections,
}: ImageViewerInfoBarProps) {
  const hasNote = note != null && note !== ''
  const hasCollections = collections != null
  if (!hasNote && !hasCollections) return null

  return (
    <Box
      data-testid="image-viewer-info-bar"
      sx={{
        mt: 2,
        flexShrink: 0,
        py: 1,
        display: { xs: 'flex', md: 'grid' },
        flexDirection: 'column',
        gap: { xs: 1.5, md: 0 },
        gridTemplateColumns: { md: hasNote && hasCollections ? '3fr 2fr' : '1fr' },
        columnGap: { md: 3 },
      }}
    >
      {hasNote && (
        <InfoCell
          key={`note-${imageId}`}
          label="Notes:"
          preWrap
          fullContent={note}
          moreAriaLabel="Show full note"
        >
          {note.replace(/\s*\n\s*/g, ' ')}
        </InfoCell>
      )}
      {hasCollections && (
        <InfoCell
          key={`collections-${imageId}`}
          label="Collections:"
          moreAriaLabel="Show all collections"
        >
          {collections}
        </InfoCell>
      )}
    </Box>
  )
}
