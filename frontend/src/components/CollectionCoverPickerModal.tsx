import { useState } from 'react'
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
 * collection's visible members in member order, with Clear/Cancel/Save.
 * Unlike the category version the member list is a prop — tile summaries
 * carry no images, so the caller fetches the collection detail first.
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
                  <TableCell padding="checkbox" />
                  <TableCell>Name</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
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
        {selectedId != null && (
          <Button onClick={() => setSelectedId(null)} color="inherit" sx={{ mr: 'auto' }}>
            Clear
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
