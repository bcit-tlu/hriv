import LockIcon from '@mui/icons-material/Lock'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { INSTRUCTOR_NOTE_VISIBILITY } from './InstructorNoteField'

interface ImageNotesContentProps {
  description?: string | null
  /** Staff-only; the API sends null to students, so they never see it. */
  instructorNote?: string | null
}

const textSx = { typography: 'body2', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

/**
 * Body of the caption's "…more" dialog: the full description and, when the
 * viewer can see one, the instructor note. Section headings only appear when
 * both are shown — with one, the dialog title already names it.
 */
export default function ImageNotesContent({ description, instructorNote }: ImageNotesContentProps) {
  const hasDescription = !!description?.trim()
  const hasInstructorNote = !!instructorNote?.trim()
  const both = hasDescription && hasInstructorNote

  return (
    <Stack spacing={2}>
      {hasDescription && (
        <Box>
          {both && (
            <Typography variant="subtitle2" component="h3">
              Description
            </Typography>
          )}
          <Box sx={textSx}>{description}</Box>
        </Box>
      )}
      {hasInstructorNote && (
        <Box>
          {both && (
            <Typography
              variant="subtitle2"
              component="h3"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
            >
              <LockIcon fontSize="inherit" aria-hidden />
              Instructor note
            </Typography>
          )}
          <Box sx={textSx}>{instructorNote}</Box>
          <Typography variant="caption" color="text.secondary">
            {INSTRUCTOR_NOTE_VISIBILITY}
          </Typography>
        </Box>
      )}
    </Stack>
  )
}
