import { useState, useCallback } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Snackbar from '@mui/material/Snackbar'
import Switch from '@mui/material/Switch'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CategoryPickerSelect from './CategoryPickerSelect'
import { isCategoryHiddenInTree } from '../treeUtils'
import type { Category, Group, Program } from '../types'

interface BulkEditCollectionsDialogProps {
  open: boolean
  onClose: () => void
  onSave: (data: { category_id?: number | null; hidden?: boolean }) => Promise<void>
  onDelete: () => Promise<void>
  categories: Category[]
  selectedCount: number
  /** Curatorial fields (refile + hidden) — admin/instructor only (#1578).
   *  When false the dialog is delete-only. */
  canCurate?: boolean
  /** False when at least one selected collection fails the caller's
   *  single-delete authority — bulk delete is all-or-nothing. */
  canDeleteAll?: boolean
  /** True when ALL selected collections sit under a hidden category —
   *  disables the visibility switch (BulkEditImagesModal convention). */
  allCategoryHidden?: boolean
  programs?: Program[]
  groups?: Group[]
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
}

/**
 * Bulk edit for the Manage → Collections table (#1578) — mirrors
 * `BulkEditImagesModal`: refile into a category and curatorial hide/show
 * for curators, plus a two-step delete for rows the caller may delete.
 * Scope (private/public/restricted) is deliberately not bulk-editable —
 * authority there is per-collection, not per-role.
 */
export default function BulkEditCollectionsDialog({
  open,
  onClose,
  onSave,
  onDelete,
  categories,
  selectedCount,
  canCurate = false,
  canDeleteAll = true,
  allCategoryHidden = false,
  programs,
  groups,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
}: BulkEditCollectionsDialogProps) {
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryChanged, setCategoryChanged] = useState(false)
  const [visible, setVisible] = useState(true)
  const [visibleChanged, setVisibleChanged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Same disable rule as BulkEditImagesModal: refiling into a hidden
  // category locks the visibility switch, and so does a selection that is
  // already entirely hidden by category.
  const nextCategoryHidden =
    categoryChanged && categoryId != null ? isCategoryHiddenInTree(categories, categoryId) : false
  const visibilityDisabled = categoryChanged ? nextCategoryHidden : allCategoryHidden

  const resetForm = useCallback(() => {
    setCategoryId(null)
    setCategoryChanged(false)
    setVisible(true)
    setVisibleChanged(false)
    setConfirmDelete(false)
    setDeleteError(null)
    setSaveError(null)
    setSaving(false)
  }, [])

  const handleEnter = useCallback(() => {
    resetForm()
  }, [resetForm])

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSave = async () => {
    setSaveError(null)
    const data: { category_id?: number | null; hidden?: boolean } = {}
    if (categoryChanged) data.category_id = categoryId
    if (visibleChanged) data.hidden = !visible
    setSaving(true)
    try {
      await onSave(data)
      resetForm()
    } catch {
      setSaving(false)
      setSaveError('Failed to save changes. Please try again.')
    }
  }

  const handleDelete = async () => {
    setDeleteError(null)
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    try {
      await onDelete()
      resetForm()
    } catch {
      setSaving(false)
      setDeleteError('Failed to delete collections. Please try again.')
    }
  }

  const noun = selectedCount === 1 ? 'collection' : 'collections'

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
    >
      <DialogTitle>Bulk Edit Collections</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Editing {selectedCount} selected {noun}.
          {canCurate ? ' Only fields you fill in will be updated.' : ''}
        </Typography>

        {canCurate && (
          <>
            <Box>
              <CategoryPickerSelect
                categories={categories}
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id)
                  setCategoryChanged(true)
                }}
                label="Move to Category"
                placeholder={!categoryChanged ? '(no change)' : undefined}
                onAddCategory={onAddCategory}
                onEditCategory={onEditCategory}
                onToggleVisibility={onToggleVisibility}
                programs={programs}
                groups={groups}
              />
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={visible}
                  disabled={visibilityDisabled}
                  onChange={(e) => {
                    setVisible(e.target.checked)
                    setVisibleChanged(true)
                  }}
                />
              }
              label={
                visibilityDisabled
                  ? 'Visibility (hidden by category)'
                  : 'Visibility (visible to students)'
              }
            />
          </>
        )}

        <Divider />

        {/* Delete — per-collection authority: the caller must be able to
            delete every selected row. */}
        <Box>
          <Tooltip
            title={
              canDeleteAll
                ? ''
                : 'You may only delete collections you own — remove the others from the selection'
            }
          >
            <span>
              <Button
                color="error"
                variant={confirmDelete ? 'contained' : 'outlined'}
                onClick={handleDelete}
                disabled={saving || !canDeleteAll}
                fullWidth
              >
                {confirmDelete
                  ? `Confirm Delete ${selectedCount} ${selectedCount === 1 ? 'Collection' : 'Collections'}`
                  : `Delete ${selectedCount} Selected ${selectedCount === 1 ? 'Collection' : 'Collections'}`}
              </Button>
            </span>
          </Tooltip>
          {confirmDelete && canDeleteAll && (
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone. Click again to confirm.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        {canCurate && (
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        )}
      </DialogActions>
      <Snackbar
        open={deleteError !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setDeleteError(null)
        }}
      >
        <Alert severity="error" variant="filled" onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={saveError !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setSaveError(null)
        }}
      >
        <Alert severity="error" variant="filled" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      </Snackbar>
    </Dialog>
  )
}
