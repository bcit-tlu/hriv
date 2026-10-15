import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import NoteDisplay from './NoteDisplay'

export interface ImageViewerInfoBarProps {
  /** NoteDisplay key so Show more resets per image. */
  imageId: number
  note?: string | null
  /** App passes <ImageCollectionsList …/> or null. */
  collections?: ReactNode
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        component="div"
        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        <strong>{label}</strong>
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, typography: 'body2' }}>{children}</Box>
    </Box>
  )
}

/**
 * Always-visible info row below the regular image viewer (#1677): Notes,
 * Collections, and the viewer instructions in a 40/40/20 grid at `md`+ (cells
 * always rendered so the instructions column never moves); below `md` the
 * cells stack and empty ones collapse.
 */
export default function ImageViewerInfoBar({
  imageId,
  note,
  collections,
}: ImageViewerInfoBarProps) {
  const hasNote = note != null && note !== ''
  const hasCollections = collections != null

  // Empty optional cells collapse below md but keep their grid column at md+.
  const optionalCellDisplay = (present: boolean) => ({
    xs: present ? 'block' : 'none',
    md: 'block',
  })

  return (
    <Paper
      variant="outlined"
      data-testid="image-viewer-info-bar"
      sx={{
        mt: 2,
        borderRadius: 2,
        bgcolor: 'background.paper',
        flexShrink: 0,
        px: 2,
        py: 1.5,
        display: { xs: 'flex', md: 'grid' },
        flexDirection: 'column',
        gap: { xs: 1.5, md: 0 },
        gridTemplateColumns: { md: '2fr 2fr 1fr' },
        columnGap: { md: 3 },
      }}
    >
      <Box sx={{ minWidth: 0, display: optionalCellDisplay(hasNote) }}>
        {hasNote && (
          <InfoRow label="Note:">
            <NoteDisplay key={imageId} note={note} />
          </InfoRow>
        )}
      </Box>
      <Box sx={{ minWidth: 0, display: optionalCellDisplay(hasCollections) }}>
        {hasCollections && <InfoRow label="Collections:">{collections}</InfoRow>}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          Scroll or tap to zoom, and drag to move/pan. Buttons in the bottom left control the view.
          The mini-map in the bottom-right shows your current view.
        </Typography>
      </Box>
    </Paper>
  )
}
