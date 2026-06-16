import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'

export interface ImageMetadataValues {
  copyright: string
  note: string
  active: boolean
}

interface ImageMetadataFieldsProps {
  values: ImageMetadataValues
  onChange: (values: ImageMetadataValues) => void
  /** Optional id prefix to avoid duplicate DOM ids when multiple instances exist. */
  idPrefix?: string
  copyrightPlaceholder?: string
  notePlaceholder?: string
  /** When true the visibility switch is disabled (image inherits hidden from category). */
  categoryHidden?: boolean
}

export default function ImageMetadataFields({
  values,
  onChange,
  copyrightPlaceholder = 'e.g. 2026 BCIT',
  notePlaceholder = 'Image note',
  categoryHidden = false,
}: ImageMetadataFieldsProps) {
  return (
    <>
      <TextField
        label="Copyright"
        fullWidth
        variant="outlined"
        value={values.copyright}
        onChange={(e) => onChange({ ...values, copyright: e.target.value })}
        placeholder={copyrightPlaceholder}
      />
      <TextField
        label="Note"
        fullWidth
        variant="outlined"
        value={values.note}
        onChange={(e) => onChange({ ...values, note: e.target.value })}
        placeholder={notePlaceholder}
      />
      <FormControlLabel
        control={
          <Switch
            checked={values.active}
            onChange={(e) => onChange({ ...values, active: e.target.checked })}
            disabled={categoryHidden}
          />
        }
        label={categoryHidden ? "Visibility (hidden by category)" : "Visibility (visible to students)"}
      />
    </>
  )
}
