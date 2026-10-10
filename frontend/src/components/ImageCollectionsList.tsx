import { Fragment, useState } from 'react'
import type { MouseEvent } from 'react'
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
 * Read-only "Collections" row for the image viewer metadata area (#1586).
 *
 * Lists the collections the current image belongs to, each name linking to that
 * collection. When there are more than `limit` (default 3), the extras collapse
 * behind a "… and N more" link that expands them inline.
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
      <strong>Collection{collections.length > 1 ? 's' : ''}:</strong>{' '}
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
