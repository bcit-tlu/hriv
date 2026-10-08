import { useState } from 'react'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

export interface ImageCollectionsListProps {
  /** Collection names the image belongs to, already server-filtered to those
   *  the caller may view and ordered for display. */
  names: string[]
  /** How many names to show before the "more" affordance. Defaults to 3. */
  limit?: number
}

/**
 * Read-only "Collections" row for the image viewer metadata area (#1586).
 *
 * Lists the collections the current image belongs to. When there are more than
 * `limit` (default 3), the extras collapse behind a "… and N more" link that
 * expands them inline. Names are plain text today; linking each to open its
 * collection is an easy future add (wrap each name in a `Link`).
 */
export default function ImageCollectionsList({ names, limit = 3 }: ImageCollectionsListProps) {
  const [expanded, setExpanded] = useState(false)

  if (names.length === 0) return null

  const truncated = !expanded && names.length > limit
  const shown = truncated ? names.slice(0, limit) : names
  const hiddenCount = names.length - limit

  return (
    <Typography color="text.secondary" component="span" variant="body2">
      <strong>Collection{names.length > 1 ? 's' : ''}:</strong> {shown.join(', ')}
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
