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

interface CollectionCoverPickerModalProps {
  open: boolean
  onClose: () => void
  /** Called with the picked member id, or `null` to restore the
   *  first-member fallback. */
  onSave: (imageId: number | null) => void
  /** Collection members visible to the caller, in member order — the
   *  detail record's `images` (summaries carry none, so the caller loads
   *  the collection before opening this). */
  images: ImageItem[]
  /** Currently pinned member (`collections.cover_image_id`); `null` when
   *  the tile is on the first-member fallback. */
  currentImageId: number | null
}

/**
 * The collection-tile analogue of `CardImagePickerModal`: radios over the
 * collection's visible members in member order, headed by a "None" row
 * that restores the first-member fallback. Unlike the category version
 * the member list is a prop — tile summaries carry no images, so the
 * caller fetches the collection detail first.
 */
export default function CollectionCoverPickerModal({
  open,
  onClose,
  onSave,
  images,
  currentImageId,
}: CollectionCoverPickerModalProps) {
  const [selectedId, setSelectedId] = useState<number | null>(currentImageId)

  const handleSave = () => {
    onSave(selectedId)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Choose Cover Image</DialogTitle>
      <DialogContent>
        {images.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No images available in this collection.
          </Typography>
        ) : (
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
                {/* Fallback row — "none" clears the pin so the tile uses
                    the first member again. */}
                <TableRow
                  hover
                  selected={selectedId === null}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setSelectedId(null)}
                >
                  <TableCell padding="checkbox">
                    <Radio
                      size="small"
                      checked={selectedId === null}
                      onChange={() => setSelectedId(null)}
                      inputProps={{ 'aria-label': 'None — uses the first image' }}
                    />
                  </TableCell>
                  <TableCell>
                    <em>None</em>
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 1 }}
                    >
                      — uses the first image
                    </Typography>
                  </TableCell>
                </TableRow>
                {images.map((image) => (
                  <TableRow
                    key={image.id}
                    hover
                    selected={selectedId === image.id}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setSelectedId(image.id)}
                  >
                    <TableCell padding="checkbox">
                      <Radio
                        size="small"
                        checked={selectedId === image.id}
                        onChange={() => setSelectedId(image.id)}
                        inputProps={{ 'aria-label': `Use ${image.name} as the cover image` }}
                      />
                    </TableCell>
                    <TableCell>{image.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
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
