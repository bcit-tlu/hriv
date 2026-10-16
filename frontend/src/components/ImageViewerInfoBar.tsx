import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import ClampedContent from './ClampedContent'

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
 * One info-bar cell: label on the left, a `ClampedContent` value on the
 * right. The label column only ever holds the label — the "…more" affordance
 * lives inside the clamp.
 */
function InfoCell({ label, children, preWrap = false, fullContent, moreAriaLabel }: InfoCellProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        component="div"
        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        <strong>{label}</strong>
      </Typography>
      <ClampedContent
        lines={2}
        popoverHeading={label.replace(/:$/, '')}
        moreAriaLabel={moreAriaLabel}
        preWrap={preWrap}
        fullContent={fullContent}
        sx={{ flex: 1, minWidth: 0 }}
      >
        {children}
      </ClampedContent>
    </Box>
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
  const hasNote = note != null && note.trim() !== ''
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
