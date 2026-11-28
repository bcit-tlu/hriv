import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import { MAX_NOTE_LENGTH } from '../constants'
import InstructorNoteField from './InstructorNoteField'

export interface ImageMetadataValues {
  copyright: string
  description: string
  instructorNote: string
  active: boolean
}

interface ImageMetadataFieldsProps {
  values: ImageMetadataValues
  onChange: (values: ImageMetadataValues) => void
  /** Optional id prefix to avoid duplicate DOM ids when multiple instances exist. */
  idPrefix?: string
  copyrightPlaceholder?: string
  descriptionPlaceholder?: string
  /** When true the visibility switch is disabled (image inherits hidden from category). */
  categoryHidden?: boolean
}

export default function ImageMetadataFields({
  values,
  onChange,
  idPrefix,
  copyrightPlaceholder = 'e.g. 2026 BCIT',
  descriptionPlaceholder = 'Image description',
  categoryHidden = false,
}: ImageMetadataFieldsProps) {
  const copyrightId = idPrefix ? `${idPrefix}-copyright` : undefined
  const descriptionId = idPrefix ? `${idPrefix}-description` : undefined
  const instructorNoteId = idPrefix ? `${idPrefix}-instructor-note` : undefined
  const visibilityId = idPrefix ? `${idPrefix}-visibility` : undefined
  const visibilityLabel = categoryHidden
    ? 'Visibility (hidden by category)'
    : values.active
      ? 'Visibility (show image)'
      : 'Visibility (hide image)'

  return (
    <>
      <TextField
        id={copyrightId}
        label="Copyright"
        fullWidth
        variant="outlined"
        value={values.copyright}
        onChange={(e) => onChange({ ...values, copyright: e.target.value })}
        placeholder={copyrightPlaceholder}
      />
      <TextField
        id={descriptionId}
        label="Description"
        fullWidth
        variant="outlined"
        value={values.description}
        onChange={(e) => onChange({ ...values, description: e.target.value })}
        placeholder={descriptionPlaceholder}
        multiline
        minRows={3}
        maxRows={10}
        slotProps={{ htmlInput: { maxLength: MAX_NOTE_LENGTH } }}
        helperText={`${values.description.length}/${MAX_NOTE_LENGTH}`}
      />
      <InstructorNoteField
        id={instructorNoteId}
        value={values.instructorNote}
        onChange={(instructorNote) => onChange({ ...values, instructorNote })}
      />
      <FormControlLabel
        control={
          <Switch
            checked={values.active}
            onChange={(e) => onChange({ ...values, active: e.target.checked })}
            disabled={categoryHidden}
            slotProps={{ input: { id: visibilityId, role: 'switch' } }}
          />
        }
        label={visibilityLabel}
      />
    </>
  )
}
