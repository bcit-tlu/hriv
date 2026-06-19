import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

interface NoteDisplayProps {
  note: string
  collapsedLines?: number
}

export default function NoteDisplay({ note, collapsedLines = 2 }: NoteDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  // Heuristic: show "more" when there are more than `collapsedLines` explicit
  // newlines or when the text is long enough that it will likely wrap to multiple
  // lines. Use a chars-per-line estimate to catch wrapped single-line text.
  const newlineCount = note.split('\n').length
  const charsPerLineEstimate = 80 // conservative estimate for wrapping
  const isLongByChars = note.length > collapsedLines * charsPerLineEstimate
  const shouldTruncate = !expanded && (newlineCount > collapsedLines || isLongByChars)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          display: shouldTruncate ? '-webkit-box' : undefined,
          WebkitLineClamp: shouldTruncate ? collapsedLines : undefined,
          WebkitBoxOrient: shouldTruncate ? 'vertical' : undefined,
        }}
      >
        <Typography variant="body2" color="text.secondary" component="div">
          {note}
        </Typography>
      </Box>
      {(newlineCount > collapsedLines || isLongByChars) && (
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded((s) => !s)}
          sx={{ alignSelf: 'flex-start', mt: -0.5 }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </Box>
  )
}
