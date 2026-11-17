import LockIcon from '@mui/icons-material/Lock'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import { MAX_NOTE_LENGTH } from '../constants'

export const INSTRUCTOR_NOTE_VISIBILITY = 'Visible to instructors, staff and admins'

interface InstructorNoteFieldProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
}

/** Staff-only note input: lock icon, visibility hint and a length counter. */
export default function InstructorNoteField({
  value,
  onChange,
  id,
  placeholder,
}: InstructorNoteFieldProps) {
  return (
    <TextField
      id={id}
      label={
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <LockIcon fontSize="inherit" aria-hidden />
          Instructor note
        </Box>
      }
      fullWidth
      variant="outlined"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      multiline
      minRows={2}
      maxRows={10}
      slotProps={{ htmlInput: { maxLength: MAX_NOTE_LENGTH } }}
      helperText={`${INSTRUCTOR_NOTE_VISIBILITY} · ${value.length}/${MAX_NOTE_LENGTH}`}
    />
  )
}
