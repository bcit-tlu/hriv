import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Radio from '@mui/material/Radio'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { visuallyHidden } from '@mui/utils'
import type { ApiMarker } from '../types'

/** The picker's staged choice: the blank tile, the first-member
 *  fallback, or a pinned member. */
type CoverChoice = 'blank' | 'auto' | number

interface BoardCoverPickerModalProps {
  open: boolean
  onClose: () => void
  /** Called with the picked member id (`null` when the fallback or the
   *  blank tile is picked) and whether the explicit blank tile is wanted. */
  onSave: (markerId: number | null, blank: boolean) => void
  /** Board members visible to the caller, in member order — loaded by the
   *  caller before opening this (summaries carry no markers). */
  markers: ApiMarker[]
  /** Currently pinned member (`boards.cover_marker_id`); `null` when the
   *  tile is on the first-member fallback or the blank tile. */
  currentMarkerId: number | null
  /** Explicit "no cover" state (`boards.cover_blank`) — the tile renders
   *  the Board-icon placeholder. */
  currentBlank: boolean
}

/**
 * The board-tile analogue of `CollectionCoverPickerModal`: radios over the
 * board's visible members in member order, headed by a "None" row (the
 * blank Board-icon tile) and an "Automatic" row (the first-member
 * fallback). The member list is a prop — tile summaries carry no markers,
 * so the caller fetches them before opening this.
 */
export default function BoardCoverPickerModal({
  open,
  onClose,
  onSave,
  markers,
  currentMarkerId,
  currentBlank,
}: BoardCoverPickerModalProps) {
  const current: CoverChoice = currentBlank ? 'blank' : (currentMarkerId ?? 'auto')
  const [choice, setChoice] = useState<CoverChoice>(current)
  // The picker stays mounted while closed, so re-stage the Board's current
  // cover on every opening rather than only at first mount.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setChoice(current)
  }

  const handleSave = () => {
    if (choice === 'blank') onSave(null, true)
    else if (choice === 'auto') onSave(null, false)
    else onSave(choice, false)
  }

  const optionRow = (value: CoverChoice, label: string, hint: string) => (
    <TableRow
      hover
      selected={choice === value}
      sx={{ cursor: 'pointer' }}
      onClick={() => setChoice(value)}
    >
      <TableCell padding="checkbox">
        <Radio
          size="small"
          checked={choice === value}
          onChange={() => setChoice(value)}
          inputProps={{ 'aria-label': `${label} ${hint}` }}
        />
      </TableCell>
      <TableCell>
        <em>{label}</em>
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {hint}
        </Typography>
      </TableCell>
    </TableRow>
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Choose Cover Image</DialogTitle>
      <DialogContent>
        {markers.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>
            No Markers available on this Board.
          </Typography>
        )}
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Box component="span" sx={visuallyHidden}>
                    Select cover image
                  </Box>
                </TableCell>
                <TableCell>Marker</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* "None" opts out of imagery — the tile renders the
                  Board-icon placeholder like an uncovered category. */}
              {optionRow('blank', 'None', '— blank card')}
              {/* "Automatic" clears both states — the tile uses the
                  first member again. */}
              {optionRow('auto', 'Automatic', '— uses the first Marker')}
              {markers.map((marker) => (
                <TableRow
                  key={marker.id}
                  hover
                  selected={choice === marker.id}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setChoice(marker.id)}
                >
                  <TableCell padding="checkbox">
                    <Radio
                      size="small"
                      checked={choice === marker.id}
                      onChange={() => setChoice(marker.id)}
                      inputProps={{ 'aria-label': `Use ${marker.title} as the cover image` }}
                    />
                  </TableCell>
                  <TableCell>{marker.title}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
