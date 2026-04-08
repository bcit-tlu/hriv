import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import VisibilityIcon from '@mui/icons-material/Visibility'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { ApiImage } from '../api'
import type { Category, Program } from '../types'
import CategoryPickerSelect from './CategoryPickerSelect'

export interface ImageFormData {
  name?: string
  category_id?: number | null
  copyright?: string
  note?: string
  program_ids?: number[]
  active?: boolean
  metadata_extra?: Record<string, unknown>
}

interface EditImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ImageFormData) => void
  onDelete?: () => Promise<void>
  image: ApiImage | null
  categories: Category[]
  programs: Program[]
  onAddCategory?: (label: string, parentId: number | null) => Promise<number | void>
  onEditCategory?: (categoryId: number, newLabel: string) => Promise<void>
  onToggleVisibility?: (categoryId: number, hidden: boolean) => Promise<void>
  onViewImage?: () => void
}

function EditImageForm({
  onClose,
  onSave,
  onDelete,
  image,
  categories,
  programs,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  onViewImage,
}: Omit<EditImageModalProps, 'open'>) {
  const [name, setName] = useState(image?.name ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(image?.category_id ?? null)
  const [copyright, setCopyright] = useState(image?.copyright ?? '')
  const [note, setNote] = useState(image?.note ?? '')
  const [programIds, setProgramIds] = useState<number[]>(image?.program_ids ?? [])
  const [active, setActive] = useState(image?.active ?? true)
  const meta = image?.metadata_extra as Record<string, unknown> | null
  const [measurementScale, setMeasurementScale] = useState<string>(
    meta?.measurement_scale != null ? String(meta.measurement_scale) : '',
  )
  const [measurementUnit, setMeasurementUnit] = useState<string>(
    typeof meta?.measurement_unit === 'string' ? meta.measurement_unit : '',
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmViewImage, setConfirmViewImage] = useState(false)

  // Track whether the form has been modified from its initial values
  const isDirty =
    name !== (image?.name ?? '') ||
    categoryId !== (image?.category_id ?? null) ||
    copyright !== (image?.copyright ?? '') ||
    note !== (image?.note ?? '') ||
    JSON.stringify(programIds) !== JSON.stringify(image?.program_ids ?? []) ||
    active !== (image?.active ?? true) ||
    measurementScale !== (meta?.measurement_scale != null ? String(meta.measurement_scale) : '') ||
    measurementUnit !== (typeof meta?.measurement_unit === 'string' ? meta.measurement_unit : '')

  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await onDelete()
    } catch {
      setDeleting(false)
    }
  }

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const value = event.target.value
    setProgramIds(typeof value === 'string' ? [] : value)
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    // Only include metadata_extra when measurement fields have been touched
    const scaleNum = measurementScale.trim() ? Number(measurementScale) : undefined
    const unitStr = measurementUnit.trim() || undefined
    const hasScale = scaleNum !== undefined && !Number.isNaN(scaleNum)
    const hasUnit = unitStr !== undefined
    const existingMeta = (image?.metadata_extra as Record<string, unknown>) ?? {}
    const hadMeasurement =
      existingMeta.measurement_scale != null || existingMeta.measurement_unit != null

    const formData: ImageFormData = {
      name: trimmedName,
      category_id: categoryId,
      copyright: copyright.trim() || undefined,
      note: note.trim() || undefined,
      program_ids: programIds,
      active,
    }

    if (hasScale || hasUnit || hadMeasurement) {
      formData.metadata_extra = {
        ...existingMeta,
        measurement_scale: hasScale ? scaleNum : null,
        measurement_unit: hasUnit ? unitStr : null,
      }
    }

    onSave(formData)
  }

  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Edit Details
        {onViewImage && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => {
              if (isDirty) {
                setConfirmViewImage(true)
              } else {
                onViewImage()
              }
            }}
          >
            View Image
          </Button>
        )}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        {/* Replace image drop zone (disabled until replacement is implemented) */}
        <Box
          sx={{
            mt: 1,
            border: '2px dashed',
            borderColor: 'grey.300',
            borderRadius: 2,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            bgcolor: 'grey.100',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        >
          <CloudUploadIcon
            sx={{ fontSize: 36, color: 'grey.400', mb: 0.5 }}
          />
          <Typography variant="body2" color="text.disabled">
            Drag and drop to replace image
          </Typography>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ mt: 0.5 }}
          >
            or browse to upload
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Image replacement processing will be added in a future update.
        </Typography>

        <TextField
          autoFocus
          label="Name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Box>
          <CategoryPickerSelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            onAddCategory={onAddCategory}
            onEditCategory={onEditCategory}
            onToggleVisibility={onToggleVisibility}
          />
        </Box>
        <TextField
          label="Copyright"
          fullWidth
          variant="outlined"
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
        />
        <TextField
          label="Note"
          fullWidth
          variant="outlined"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <FormControl fullWidth>
          <InputLabel id="program-select-label">Program</InputLabel>
          <Select
            labelId="program-select-label"
            multiple
            value={programIds}
            onChange={handleProgramChange}
            input={<OutlinedInput label="Program" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((id) => {
                  const prog = programs.find((p) => p.id === id)
                  return <Chip key={id} label={prog?.name ?? id} size="small" />
                })}
              </Box>
            )}
          >
            {programs.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Multiple programs can be selected.
          </Typography>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          }
          label="Active (visible to students)"
        />
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          Measurement Settings
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Scale (px per unit)"
            fullWidth
            variant="outlined"
            type="number"
            value={measurementScale}
            onChange={(e) => setMeasurementScale(e.target.value)}
            helperText="Image pixels per real-world unit"
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          />
          <TextField
            label="Unit"
            fullWidth
            variant="outlined"
            value={measurementUnit}
            onChange={(e) => setMeasurementUnit(e.target.value)}
            helperText='e.g. "mm", "um", "cm"'
          />
        </Box>
        {image && image.created_at && image.updated_at && (
          <Box sx={{ display: 'flex', gap: 4, mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              <strong>Created:</strong> {new Date(image.created_at).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <strong>Modified:</strong> {new Date(image.updated_at).toLocaleString()}
            </Typography>
          </Box>
        )}

        {onDelete && (
          <>
            <Divider />
            <Box>
              <Button
                color="error"
                variant={confirmDelete ? 'contained' : 'outlined'}
                onClick={handleDelete}
                disabled={deleting}
                fullWidth
              >
                {confirmDelete
                  ? 'Confirm Delete Image'
                  : 'Delete Image'}
              </Button>
              {confirmDelete && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
                >
                  This action cannot be undone. Click again to confirm.
                </Typography>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      {confirmViewImage && (
        <Box
          sx={{
            px: 3,
            py: 1.5,
            bgcolor: 'warning.light',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="body2">
            You have unsaved changes. Discard and view image?
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, ml: 2, flexShrink: 0 }}>
            <Button size="small" onClick={() => setConfirmViewImage(false)}>
              Cancel
            </Button>
            <Button size="small" variant="contained" color="warning" onClick={onViewImage}>
              Discard &amp; View
            </Button>
          </Box>
        </Box>
      )}
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!name.trim() || deleting}
        >
          Save
        </Button>
      </DialogActions>
    </>
  )
}

export default function EditImageModal({
  open,
  onClose,
  onSave,
  onDelete,
  image,
  categories,
  programs,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  onViewImage,
}: EditImageModalProps) {
  const formKey = image ? `edit-${image.id}` : 'closed'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      {open && (
        <EditImageForm
          key={formKey}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
          image={image}
          categories={categories}
          programs={programs}
          onAddCategory={onAddCategory}
          onEditCategory={onEditCategory}
          onToggleVisibility={onToggleVisibility}
          onViewImage={onViewImage}
        />
      )}
    </Dialog>
  )
}
