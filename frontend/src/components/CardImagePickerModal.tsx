import { useState, useMemo } from 'react'
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
import type { Category, ImageItem } from '../types'

interface FlatImage {
  image: ImageItem
  categoryLabel: string
}

function collectImages(cat: Category, parentLabel: string): FlatImage[] {
  const label = parentLabel ? `${parentLabel} : ${cat.label}` : cat.label
  const result: FlatImage[] = cat.images.map((img) => ({
    image: img,
    categoryLabel: label,
  }))
  for (const child of cat.children) {
    result.push(...collectImages(child, label))
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

  const handleSave = () => {
    onSave(selectedId)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Choose Card Image</DialogTitle>
      <DialogContent>
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
                {allImages.map(({ image, categoryLabel }) => (
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
