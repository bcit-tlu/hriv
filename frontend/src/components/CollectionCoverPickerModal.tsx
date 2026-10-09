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
import type { ImageItem } from '../types'

/** The picker's staged choice: the blank tile, the first-member
 *  fallback, or a pinned member. */
type CoverChoice = 'blank' | 'auto' | number

interface CollectionCoverPickerModalProps {
  open: boolean
  onClose: () => void
  /** Called with the picked member id (`null` when the fallback or the
   *  blank tile is picked) and whether the explicit blank tile is wanted. */
  onSave: (imageId: number | null, blank: boolean) => void
  /** Collection members visible to the caller, in member order — the
   *  detail record's `images` (summaries carry none, so the caller loads
   *  the collection before opening this). */
  images: ImageItem[]
  /** Currently pinned member (`collections.cover_image_id`); `null` when
   *  the tile is on the first-member fallback or the blank tile. */
  currentImageId: number | null
  /** Explicit "no cover" state (`collections.cover_blank`) — the tile
   *  renders the type-logo placeholder. */
  currentBlank: boolean
}

/**
 * The collection-tile analogue of `CardImagePickerModal`: radios over the
 * collection's visible members in member order, headed by a "None" row
 * (the blank type-logo tile) and an "Automatic" row (the first-member
 * fallback). Unlike the category version the member list is a prop —
 * tile summaries carry no images, so the caller fetches the collection
 * detail first.
 */
export default function CollectionCoverPickerModal({
  open,
  onClose,
  onSave,
  images,
  currentImageId,
  currentBlank,
}: CollectionCoverPickerModalProps) {
  const [choice, setChoice] = useState<CoverChoice>(
    currentBlank ? 'blank' : (currentImageId ?? 'auto'),
  )

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
        {images.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>
            No images available in this collection.
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
                <TableCell>Name</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* "None" opts out of imagery — the tile renders the
                  type-logo placeholder like an uncovered category. */}
              {optionRow('blank', 'None', '— blank card')}
              {/* "Automatic" clears both states — the tile uses the
                  first member again. */}
              {optionRow('auto', 'Automatic', '— uses the first image')}
              {images.map((image) => (
                <TableRow
                  key={image.id}
                  hover
                  selected={choice === image.id}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setChoice(image.id)}
                >
                  <TableCell padding="checkbox">
                    <Radio
                      size="small"
                      checked={choice === image.id}
                      onChange={() => setChoice(image.id)}
                      inputProps={{ 'aria-label': `Use ${image.name} as the cover image` }}
                    />
                  </TableCell>
                  <TableCell>{image.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
