import { useState, useCallback, useRef } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Snackbar from '@mui/material/Snackbar'
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

/** Recognised image MIME types (must stay in sync with backend). */
const IMAGE_MIME_TYPES = new Set<string>([
  'image/jpeg', 'image/png', 'image/tiff', 'image/gif', 'image/webp',
])

/** Recognised image extensions for drag-and-drop validation. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff', '.svs',
])

const ACCEPTED_IMAGE_TYPES =
  'image/jpeg,image/png,image/tiff,image/gif,image/webp,.tif,.tiff,.svs'

function isImageFile(file: File): boolean {
  if (IMAGE_MIME_TYPES.has(file.type)) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export interface ReplaceImageData {
  file: File
  formData: ImageFormData
}

interface EditImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ImageFormData) => void
  onDelete?: () => Promise<void>
  onReplace?: (data: ReplaceImageData) => Promise<void>
  replaceUploadProgress?: number
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
  onReplace,
  replaceUploadProgress,
  image,
  categories,
  programs,
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
  onViewImage,
}: Omit<EditImageModalProps, 'open'>) {
  const uploadInProgress = replaceUploadProgress !== undefined
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [confirmViewImage, setConfirmViewImage] = useState(false)

  // Replacement state
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)

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
      setDeleteError('Failed to delete image. Please try again.')
    }
  }

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const value = event.target.value
    setProgramIds(typeof value === 'string' ? [] : value)
  }

  const buildFormData = (): ImageFormData | null => {
    const trimmedName = name.trim()
    if (!trimmedName) return null
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

    return formData
  }

  const handleSave = () => {
    const formData = buildFormData()
    if (!formData) return
    onSave(formData)
  }

  // ── Replacement handlers ──────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!onReplace) return
    const dropped = e.dataTransfer.files[0]
    if (dropped && isImageFile(dropped)) {
      setReplaceFile(dropped)
      setConfirmReplace(false)
    }
  }, [onReplace])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (onReplace) setDragOver(true)
  }, [onReplace])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected && isImageFile(selected)) {
        setReplaceFile(selected)
        setConfirmReplace(false)
      }
    },
    [],
  )

  const handleClearFile = () => {
    setReplaceFile(null)
    setConfirmReplace(false)
    setReplaceError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleReplace = async () => {
    if (!onReplace || !replaceFile) return
    if (!confirmReplace) {
      setConfirmReplace(true)
      return
    }
    const formData = buildFormData()
    if (!formData) return
    setReplacing(true)
    setReplaceError(null)
    try {
      await onReplace({ file: replaceFile, formData })
    } catch {
      setReplacing(false)
      setReplaceError('Failed to replace image. Please try again.')
    }
  }

  const busy = deleting || (replacing && !uploadInProgress)

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
        {/* Replace image drop zone */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          hidden
          onChange={handleFileSelect}
        />
        <Box
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={onReplace ? () => fileInputRef.current?.click() : undefined}
          sx={{
            mt: 1,
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : replaceFile ? 'success.main' : 'grey.400',
            borderRadius: 2,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            bgcolor: dragOver ? 'action.hover' : replaceFile ? 'success.50' : 'grey.50',
            transition: 'all 0.2s',
            cursor: onReplace ? 'pointer' : 'default',
            opacity: onReplace ? 1 : 0.6,
          }}
        >
          <CloudUploadIcon
            sx={{ fontSize: 36, color: replaceFile ? 'success.main' : 'grey.500', mb: 0.5 }}
          />
          {replaceFile ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {replaceFile.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatBytes(replaceFile.size)}
              </Typography>
              <Button
                size="small"
                onClick={(e) => { e.stopPropagation(); handleClearFile() }}
                sx={{ mt: 0.5 }}
              >
                Clear
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color={onReplace ? 'text.secondary' : 'text.disabled'}>
                Drag and drop to replace image
              </Typography>
              <Typography
                variant="caption"
                color={onReplace ? 'text.secondary' : 'text.disabled'}
                sx={{ mt: 0.5 }}
              >
                or{' '}
                <Typography
                  component="span"
                  variant="caption"
                  color={onReplace ? 'primary' : 'text.disabled'}
                  sx={onReplace ? { cursor: 'pointer', textDecoration: 'underline' } : {}}
                >
                  browse to upload
                </Typography>
              </Typography>
            </>
          )}
        </Box>

        {replaceFile && confirmReplace && (
          <Alert severity="warning" sx={{ mt: -1 }}>
            Replacing this image will delete the current image file, all tiles,
            and any canvas annotations and overlays. This cannot be undone.
            Click &quot;Replace &amp; Save&quot; again to confirm.
          </Alert>
        )}

        {uploadInProgress && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {`Uploading replacement \u2014 ${Math.round(replaceUploadProgress * 100)}%`}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={Math.round(replaceUploadProgress * 100)}
              sx={{ height: 6, borderRadius: 1 }}
            />
          </Box>
        )}

        {replaceError && (
          <Alert severity="error" sx={{ mt: -1 }} onClose={() => setReplaceError(null)}>
            {replaceError}
          </Alert>
        )}

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
                disabled={busy}
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
        <Button onClick={onClose} disabled={busy}>{uploadInProgress ? 'Close' : 'Cancel'}</Button>
        {replaceFile && onReplace ? (
          <Button
            onClick={handleReplace}
            variant="contained"
            color={confirmReplace ? 'warning' : 'primary'}
            disabled={!name.trim() || busy || uploadInProgress}
          >
            {confirmReplace ? 'Confirm Replace & Save' : 'Replace & Save'}
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || busy}
          >
            Save
          </Button>
        )}
      </DialogActions>
      <Snackbar
        open={deleteError !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => { if (reason === 'clickaway') return; setDeleteError(null) }}
      >
        <Alert severity="error" variant="filled" onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      </Snackbar>
    </>
  )
}

export default function EditImageModal({
  open,
  onClose,
  onSave,
  onDelete,
  onReplace,
  replaceUploadProgress,
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
          onReplace={onReplace}
          replaceUploadProgress={replaceUploadProgress}
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
