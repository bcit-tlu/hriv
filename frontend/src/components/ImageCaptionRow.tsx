import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import ClampedContent from './ClampedContent'

export interface ImageCaptionRowProps {
  /** Image name, rendered as an h2. */
  name: string
  /** false appends an ' (inactive)' marker to the title. */
  active?: boolean
  /** The image's note; whitespace-only notes render nothing. */
  note?: string | null
  /** Whether the caller's notes dialog is open (aria-expanded on "…more"). */
  noteDialogOpen?: boolean
  /** Open the full note (callers show a ViewportDialog). */
  onShowNote: () => void
  /** Right-hand content (position readout, Open image, fitted collections). */
  end?: ReactNode
}

/**
 * The caption row shared by the image view and the collection viewers:
 * `[h2 image title] [Notes: note …more] {end}`. The note clamps to one line
 * with an "…more" affordance that opens the caller's dialog. When a note is
 * present the title is capped at min(468px, 40%) so the note gets the room
 * in narrow panes while typical image names still fit.
 */
export default function ImageCaptionRow({
  name,
  active = true,
  note,
  noteDialogOpen = false,
  onShowNote,
  end,
}: ImageCaptionRowProps) {
  const noteText = note?.trim() ?? ''

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        columnGap: 1,
        rowGap: 0.5,
        mt: 0.5,
        flexShrink: 0,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
      }}
    >
      <Typography
        variant="subtitle1"
        component="h2"
        noWrap
        title={name}
        sx={
          noteText !== ''
            ? { flex: '0 1 auto', minWidth: 0, maxWidth: 'min(468px, 40%)', mr: 4 }
            : { flex: 1, minWidth: 0 }
        }
      >
        {name}
        {!active ? ' (inactive)' : ''}
      </Typography>
      {note != null && noteText !== '' && (
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            gap: 0.5,
            alignItems: 'baseline',
            // Match the title→Notes gap before the end slot.
            ...(end != null ? { mr: 4 } : {}),
          }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            component="span"
            sx={{ whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 'bold' }}
          >
            Notes:
          </Typography>
          <ClampedContent
            lines={1}
            onMore={onShowNote}
            expanded={noteDialogOpen}
            moreAriaLabel="Show full note"
            sx={{ flex: 1, minWidth: 0 }}
          >
            {note.replace(/\s*\n\s*/g, ' ')}
          </ClampedContent>
        </Box>
      )}
      {end}
    </Box>
  )
}
