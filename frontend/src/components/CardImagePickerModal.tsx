import { useState, useMemo } from 'react'
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
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import type { Category, ImageItem } from '../types'

interface FlatImage {
  image: ImageItem
  categoryLabel: string
  /** Inactive image, or filed under a hidden category/ancestor (#1609). */
  hidden: boolean
  /** Program- or group-restricted category/ancestor (#1609). */
  restricted: boolean
}

const LIMITED_VISIBILITY_NOTE =
  'Hidden or restricted for some students — they will still see this cover as the tile thumbnail.'

// The walk starts at the picked category, so flags only accumulate over the
// subtree below it — restrictions on ancestors above it gate the whole tile
// anyway and need no per-row annotation.
function collectImages(
  cat: Category,
  parentLabel: string,
  ancestorHidden = false,
  ancestorRestricted = false,
): FlatImage[] {
  const label = parentLabel ? `${parentLabel} : ${cat.label}` : cat.label
  const hiddenHere = ancestorHidden || cat.status === 'hidden'
  const restrictedHere = ancestorRestricted || cat.programIds.length > 0 || cat.groupIds.length > 0
  const result: FlatImage[] = cat.images.map((img) => ({
    image: img,
    categoryLabel: label,
    hidden: hiddenHere || !img.active,
    restricted: restrictedHere,
  }))
  for (const child of cat.children) {
    result.push(...collectImages(child, label, hiddenHere, restrictedHere))
  }
  return result
}

interface CardImagePickerModalProps {
  open: boolean
  onClose: () => void
  onSave: (imageId: number | null) => void
  category: Category
  currentImageId: number | null
}

export default function CardImagePickerModal({
  open,
  onClose,
  onSave,
  category,
  currentImageId,
}: CardImagePickerModalProps) {
  const [selectedId, setSelectedId] = useState<number | null>(currentImageId)

  const allImages = useMemo(() => collectImages(category, ''), [category])
  const anyLimited = allImages.some((row) => row.hidden || row.restricted)

  const handleSave = () => {
    onSave(selectedId)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Choose Card Image</DialogTitle>
      <DialogContent>
        {anyLimited && (
          <Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>
            {LIMITED_VISIBILITY_NOTE}
          </Typography>
        )}
        {allImages.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No images available in this category or its sub-categories.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Name</TableCell>
                  <TableCell>Category</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allImages.map(({ image, categoryLabel, hidden, restricted }) => (
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
                    <TableCell>
                      <Box
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                      >
                        {image.name}
                        {(hidden || restricted) && (
                          <Tooltip title={LIMITED_VISIBILITY_NOTE}>
                            <VisibilityOff
                              data-testid="limited-visibility-icon"
                              fontSize="small"
                              sx={{ color: 'text.secondary' }}
                            />
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{categoryLabel}</TableCell>
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
