import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

export interface ImageCollectionsListItem {
  id: number
  name: string
}

export interface ImageCollectionsListProps {
  /** Collections the image belongs to, already server-filtered to those the
   *  caller may view and ordered for display. */
  collections: ImageCollectionsListItem[]
  /** How many to show before the "more" affordance. Defaults to 3. */
  limit?: number
  /** Open a collection in-app (SPA navigation). Called on a plain left click. */
  onOpenCollection: (id: number) => void
  /** Optional href builder so each name renders as a real anchor — lets
   *  modifier- or middle-click open the collection in a new tab. Plain clicks
   *  still route through `onOpenCollection` for in-app navigation. When omitted,
   *  names render as button-style links. */
  hrefForCollection?: (id: number) => string
}

/** A plain left click (no modifier, primary button) — the only case we hijack
 *  for in-app navigation; everything else falls through to the real href. */
function isModifiedClick(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}

/**
 * Read-only "Collections" links for the image viewer info bar (#1586, #1677).
 *
 * Lists the collections the current image belongs to, each name linking to that
 * collection. When there are more than `limit` (default 3), the extras collapse
 * behind a "… and N more" link that expands them inline. The "Collections:"
 * label is rendered by the caller (`ImageViewerInfoBar`).
 */
export default function ImageCollectionsList({
  collections,
  limit = 3,
  onOpenCollection,
  hrefForCollection,
}: ImageCollectionsListProps) {
  const [expanded, setExpanded] = useState(false)

  if (collections.length === 0) return null

  const truncated = !expanded && collections.length > limit
  const shown = truncated ? collections.slice(0, limit) : collections
  const hiddenCount = collections.length - limit

  return (
    <Typography color="text.secondary" component="span" variant="body2">
      {shown.map((collection, index) => {
        const href = hrefForCollection?.(collection.id)
        const linkProps = href ? { href } : ({ component: 'button', type: 'button' } as const)
        return (
          <Fragment key={collection.id}>
            {index > 0 && ', '}
            <Link
              {...linkProps}
              onClick={(e: MouseEvent) => {
                // Let modifier/middle clicks follow the real href (open in a new
                // tab); a plain click navigates in-app.
                if (href && isModifiedClick(e)) return
                e.preventDefault()
                onOpenCollection(collection.id)
              }}
              underline="hover"
              variant="body2"
            >
              {collection.name}
            </Link>
          </Fragment>
        )
      })}
      {truncated && (
        <>
          {' … and '}
          <Link
            component="button"
            onClick={() => setExpanded(true)}
            type="button"
            underline="hover"
            variant="body2"
          >
            {hiddenCount} more
          </Link>
        </>
      )}
    </Typography>
  )
}

export interface FittedCollectionsProps {
  /** Collections the image belongs to, ordered for display. */
  collections: ImageCollectionsListItem[]
  /** Open a collection in-app (SPA navigation) on a plain left click. */
  onOpenCollection: (id: number) => void
  /** Optional href builder — lets modifier/middle clicks open a new tab. */
  hrefForCollection?: (id: number) => string
  /** Whether the caller's collections dialog is open (aria-expanded). */
  dialogOpen?: boolean
  /** Open the full collections list (callers show a ViewportDialog). */
  onShowCollections: () => void
}

/**
 * Right-aligned "Collections:" cell for `ImageCaptionRow` (#1677). Shows the
 * largest prefix of collection names that fits the cell's width; the rest
 * collapse behind a "… + N more" link that opens the caller's dialog with the
 * full list.
 *
 * Fit is measured with an `aria-hidden` clone of plain text spans (nothing
 * focusable) laid out off-screen: label + names + the worst-case suffix are
 * summed against the cell's `clientWidth`. In environments with no layout
 * (jsdom, zero widths) every name is shown, so behaviour stays accessible.
 */
export function FittedCollections({
  collections,
  onOpenCollection,
  hrefForCollection,
  dialogOpen = false,
  onShowCollections,
}: FittedCollectionsProps) {
  const cellRef = useRef<HTMLDivElement | null>(null)
  const cloneRef = useRef<HTMLDivElement | null>(null)
  const [fitCount, setFitCount] = useState(collections.length)
  const n = collections.length
  const suffixText = `… + ${n} more`

  useLayoutEffect(() => {
    const cell = cellRef.current
    const clone = cloneRef.current
    if (!cell || !clone) return
    const measure = () => {
      const available = cell.clientWidth
      const spans = [...clone.querySelectorAll<HTMLElement>('span')]
      const widths = spans.map((s) => s.getBoundingClientRect().width)
      // No layout (jsdom, hidden) — show everything.
      if (available <= 0 || widths.every((w) => w === 0)) {
        setFitCount(n)
        return
      }
      const [labelWidth, ...rest] = widths
      // rest holds each "name + separator" sample and ends with the suffix.
      const nameWidths = rest.slice(0, n)
      const suffixWidth = rest[n] ?? 0
      const namesWidth = (k: number) => nameWidths.slice(0, k).reduce((a, w) => a + w, 0)
      if (labelWidth + namesWidth(n) <= available) {
        setFitCount(n)
        return
      }
      // Largest prefix whose names + label + suffix fit; at least one name
      // always shows (it ellipsizes when it cannot fit).
      let k = 1
      while (k < n && labelWidth + namesWidth(k + 1) + suffixWidth <= available) k += 1
      setFitCount(k)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(cell)
    return () => ro.disconnect()
  }, [n, collections])

  if (n === 0) return null

  const shown = collections.slice(0, Math.min(fitCount, n))
  const hiddenCount = n - shown.length

  return (
    <Box
      ref={cellRef}
      sx={{
        ml: { xs: 0, md: 'auto' },
        flex: { md: '0 1 auto' },
        flexBasis: { xs: '100%', md: 'auto' },
        minWidth: 0,
        maxWidth: { xs: '100%', md: '30%' },
        display: 'flex',
        alignItems: 'baseline',
        gap: 0.5,
        whiteSpace: 'nowrap',
        justifyContent: { xs: 'flex-start', md: 'flex-end' },
        position: 'relative',
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        component="span"
        sx={{ whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 'bold' }}
      >
        Collections:
      </Typography>
      <Typography color="text.secondary" component="span" variant="body2" sx={{ minWidth: 0 }}>
        {shown.map((collection, index) => {
          const href = hrefForCollection?.(collection.id)
          const linkProps = href ? { href } : ({ component: 'button', type: 'button' } as const)
          return (
            <Fragment key={collection.id}>
              {index > 0 && ', '}
              <Link
                {...linkProps}
                onClick={(e: MouseEvent) => {
                  if (href && isModifiedClick(e)) return
                  e.preventDefault()
                  onOpenCollection(collection.id)
                }}
                underline="hover"
                variant="body2"
                // The first (only) shown name ellipsizes when it alone is
                // wider than the cell; the suffix still renders.
                {...(index === 0
                  ? {
                      sx: {
                        display: 'inline-block',
                        maxWidth: '100%',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        verticalAlign: 'bottom',
                      },
                    }
                  : {})}
              >
                {collection.name}
              </Link>
            </Fragment>
          )
        })}
        {hiddenCount > 0 && (
          <>
            {' … '}
            <Link
              component="button"
              type="button"
              underline="hover"
              variant="body2"
              aria-label={`Show all ${n} collections`}
              aria-haspopup="dialog"
              aria-expanded={dialogOpen}
              onClick={onShowCollections}
            >
              {`+ ${hiddenCount} more`}
            </Link>
          </>
        )}
      </Typography>
      {/* Off-screen clone used to measure name/suffix widths: plain spans,
          nothing focusable. */}
      <Box
        ref={cloneRef}
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          typography: 'body2',
        }}
      >
        <span>Collections:</span>
        {collections.map((collection, index) => (
          <span key={collection.id}>
            {index > 0 ? ', ' : ''}
            {collection.name}
          </span>
        ))}
        <span>{` ${suffixText}`}</span>
      </Box>
    </Box>
  )
}
