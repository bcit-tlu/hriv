import { useState, useCallback } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { ApiImage } from '../api'
import type { Category } from '../types'

interface MoveImageDialogProps {
  open: boolean
  onClose: () => void
  onMove: (categoryId: number | null) => Promise<void>
  image: ApiImage | null
  categories: Category[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<void>
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
}

export default function MoveImageDialog({
  open,
  onClose,
  onMove,
  image,
  categories,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
}: MoveImageDialogProps) {
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const handleEnter = useCallback(() => {
    setNewCategoryId(image?.category_id ?? null)
  }, [image])

  const handleMove = async () => {
    setSaving(true)
    try {
      await onMove(newCategoryId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Move Image</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {image && (
          <Typography variant="body2" color="text.secondary">
            Move &ldquo;{image.name}&rdquo; to a different category.
          </Typography>
        )}
        <CategoryPickerSelect
          categories={categories}
          value={newCategoryId}
          onChange={setNewCategoryId}
          label="Destination"
          onAddCategory={onAddCategory}
          onEditCategory={onEditCategory}
          onToggleVisibility={onToggleVisibility}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleMove} variant="contained" disabled={saving}>
          {saving ? 'Moving…' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
