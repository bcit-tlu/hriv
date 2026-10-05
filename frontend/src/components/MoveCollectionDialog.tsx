import { useState, useCallback } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import type { Category, CollectionSummary, Group, Program } from '../types'

interface MoveCollectionDialogProps {
  open: boolean
  onClose: () => void
  onMove: (categoryId: number | null) => Promise<void> | void
  collection: CollectionSummary | null
  categories: Category[]
  onAddCategory?: (
    label: string,
    parentId: number | null,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<number | void>
  onEditCategory?: (
    categoryId: number,
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<void>
  onToggleVisibility?: (categoryId: number) => Promise<void>
  programs?: Program[]
  groups?: Group[]
}

/**
 * File a collection into a Browse category (#1529). Mirrors
 * `MoveImageDialog`: the destination may be the root ("Top level" option),
 * and the picker starts at the collection's current category so an
 * unchanged "Move" is a harmless no-op server-side.
 */
export default function MoveCollectionDialog({
  open,
  onClose,
  onMove,
  collection,
  categories,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  programs,
  groups,
}: MoveCollectionDialogProps) {
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const handleEnter = useCallback(() => {
    setNewCategoryId(collection?.categoryId ?? null)
  }, [collection])

  const handleMove = async () => {
    setSaving(true)
    try {
      await onMove(newCategoryId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
    >
      <DialogTitle>Move Collection</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {collection && (
          <Typography variant="body2" color="text.secondary">
            Move &ldquo;{collection.name}&rdquo; to a different category.
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
          programs={programs}
          groups={groups}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleMove} variant="contained" disabled={saving}>
          {saving ? 'Moving…' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
