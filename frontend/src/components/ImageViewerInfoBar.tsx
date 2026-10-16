import Box from '@mui/material/Box'
import ImageCaptionRow from './ImageCaptionRow'
import { FittedCollections, type ImageCollectionsListItem } from './ImageCollectionsList'

export interface ImageViewerInfoBarProps {
  imageId: number
  /** Image name, rendered as the row's h2. */
  name: string
  /** false appends an ' (inactive)' marker. */
  active?: boolean
  note?: string | null
  /** Collections the image belongs to (may be empty). */
  collections: ImageCollectionsListItem[]
  onOpenCollection: (id: number) => void
  hrefForCollection?: (id: number) => string
  /** Whether the caller's notes/collections dialogs are open. */
  noteDialogOpen?: boolean
  collectionsDialogOpen?: boolean
  /** Open the full note / collections list (callers show a ViewportDialog). */
  onShowNote: () => void
  onShowCollections: () => void
}

/**
 * Always-visible caption row below the regular image viewer (#1677): the
 * image title on the left, its note clamped to one line ("…more" opens the
 * caller's notes dialog), and the fitted collections cell on the right
 * ("+ N more" opens the caller's collections dialog). The row always renders
 * because the title is always shown.
 */
export default function ImageViewerInfoBar({
  imageId,
  name,
  active = true,
  note,
  collections,
  onOpenCollection,
  hrefForCollection,
  noteDialogOpen,
  collectionsDialogOpen,
  onShowNote,
  onShowCollections,
}: ImageViewerInfoBarProps) {
  return (
    <Box data-testid="image-viewer-info-bar" sx={{ mt: 2, flexShrink: 0 }}>
      <ImageCaptionRow
        key={`caption-${imageId}`}
        name={name}
        active={active}
        note={note}
        noteDialogOpen={noteDialogOpen}
        onShowNote={onShowNote}
        end={
          collections.length > 0 ? (
            <FittedCollections
              collections={collections}
              onOpenCollection={onOpenCollection}
              hrefForCollection={hrefForCollection}
              dialogOpen={collectionsDialogOpen}
              onShowCollections={onShowCollections}
            />
          ) : undefined
        }
      />
    </Box>
  )
}
