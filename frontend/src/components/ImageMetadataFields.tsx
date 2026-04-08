import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import OutlinedInput from '@mui/material/OutlinedInput'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Program } from '../types'

export interface ImageMetadataValues {
  copyright: string
  note: string
  programIds: number[]
  active: boolean
}

interface ImageMetadataFieldsProps {
  values: ImageMetadataValues
  onChange: (values: ImageMetadataValues) => void
  programs: Program[]
  /** Optional id prefix to avoid duplicate DOM ids when multiple instances exist. */
  idPrefix?: string
  copyrightPlaceholder?: string
  notePlaceholder?: string
}

export default function ImageMetadataFields({
  values,
  onChange,
  programs,
  idPrefix = 'img-meta',
  copyrightPlaceholder = 'e.g. 2026 BCIT',
  notePlaceholder = 'Image note',
}: ImageMetadataFieldsProps) {
  const labelId = `${idPrefix}-program-select-label`

  const handleProgramChange = (event: SelectChangeEvent<number[]>) => {
    const val = event.target.value
    onChange({ ...values, programIds: typeof val === 'string' ? [] : val })
  }

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
      <FormControl fullWidth>
        <InputLabel id={labelId}>Program</InputLabel>
        <Select
          labelId={labelId}
          multiple
          value={values.programIds}
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
            checked={values.active}
            onChange={(e) => onChange({ ...values, active: e.target.checked })}
          />
        }
        label="Active (visible to students)"
      />
    </>
  )
}
