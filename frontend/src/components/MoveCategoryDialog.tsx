import { useState, useCallback } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category } from '../types'

interface MoveCategoryDialogProps {
  open: boolean
  onClose: () => void
  onMove: (categoryId: number, newParentId: number | null) => void
  category: Category | null
  categories: Category[]
}

export default function MoveCategoryDialog({
  open,
  onClose,
  onMove,
  category,
  categories,
}: MoveCategoryDialogProps) {
  const [newParentId, setNewParentId] = useState<number | null>(null)

  const handleEnter = useCallback(() => {
    setNewParentId(category?.parentId ?? null)
  }, [category])

  const handleMove = () => {
    if (!category) return
    onMove(category.id, newParentId)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Move Category</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {category && (
          <Typography variant="body2" color="text.secondary">
            Move &ldquo;{category.label}&rdquo; to a new parent category.
          </Typography>
        )}
        <CategoryPickerSelect
          categories={categories}
          value={newParentId}
          onChange={setNewParentId}
          label="Destination"
          excludeCategoryId={category?.id}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleMove} variant="contained">
          Move
        </Button>
      </DialogActions>
    </Dialog>
  )
}
