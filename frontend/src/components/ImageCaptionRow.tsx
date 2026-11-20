import LockIcon from '@mui/icons-material/Lock'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import ClampedContent from './ClampedContent'

export interface ImageCaptionRowProps {
  /** Image name, rendered as an h2. */
  name: string
  /** false appends an ' (inactive)' marker to the title. */
  active?: boolean
  /** The image's description; whitespace-only text renders nothing. */
  description?: string | null
  /** Staff-only note (null for students); whitespace-only renders nothing. */
  instructorNote?: string | null
  /** Whether the caller's notes dialog is open (aria-expanded on "…more"). */
  noteDialogOpen?: boolean
  /** Open the full note (callers show a ViewportDialog). */
  onShowNote: () => void
  /** Right-hand content (position readout, Open image, fitted collections). */
  end?: ReactNode
}

/**
 * The caption row shared by the image view and the collection viewers:
 * `[h2 image title] [Description: … …more] [🔒 Instructor note: … …more] {end}`.
 * Each text cell clamps to one line with an "…more" affordance that opens the
 * caller's dialog; the instructor note cell only renders when the API sent one
 * (never for students). When either text is present the title is capped at
 * min(468px, 40%) so the text gets the room in narrow panes while typical image
 * names still fit.
 */
export default function ImageCaptionRow({
  name,
  active = true,
  description,
  instructorNote,
  noteDialogOpen = false,
  onShowNote,
  end,
}: ImageCaptionRowProps) {
  const descriptionText = description?.trim() ?? ''
  const instructorText = instructorNote?.trim() ?? ''
  const hasText = descriptionText !== '' || instructorText !== ''

  // One clamped "label: text …more" cell; both cells open the same dialog.
  const segment = (label: ReactNode, text: string, moreAriaLabel: string, spaced: boolean) => (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        gap: 0.5,
        alignItems: 'baseline',
        // Match the title→Description gap before whatever follows.
        ...(spaced ? { mr: 4 } : {}),
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        component="span"
        sx={{ whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 'bold' }}
      >
        {label}
      </Typography>
      <ClampedContent
        lines={1}
        onMore={onShowNote}
        expanded={noteDialogOpen}
        moreAriaLabel={moreAriaLabel}
        sx={{ flex: 1, minWidth: 0 }}
      >
        {text.replace(/\s*\n\s*/g, ' ')}
      </ClampedContent>
    </Box>
  )

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
          hasText
            ? { flex: '0 1 auto', minWidth: 0, maxWidth: 'min(468px, 40%)', mr: 4 }
            : { flex: 1, minWidth: 0 }
        }
      >
        {name}
        {!active ? ' (inactive)' : ''}
      </Typography>
      {descriptionText !== '' &&
        segment(
          'Description:',
          descriptionText,
          'Show full description',
          instructorText !== '' || end != null,
        )}
      {instructorText !== '' &&
        segment(
          <>
            <LockIcon fontSize="inherit" aria-hidden sx={{ alignSelf: 'center', mr: 0.25 }} />
            Instructor note:
          </>,
          instructorText,
          'Show full instructor note',
          end != null,
        )}
      {end}
    </Box>
  )
}
