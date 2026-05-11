import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
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
  copyrightPlaceholder = 'e.g. 2026 BCIT',
  notePlaceholder = 'Image note',
}: ImageMetadataFieldsProps) {
  const toggleProgram = useCallback(
    (id: number) => {
      const next = values.programIds.includes(id)
        ? values.programIds.filter((pid) => pid !== id)
        : [...values.programIds, id]
      onChange({ ...values, programIds: next })
    },
    [onChange, values],
  )

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
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Program
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {programs.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              size="small"
              color={values.programIds.includes(p.id) ? 'primary' : 'default'}
              variant={values.programIds.includes(p.id) ? 'filled' : 'outlined'}
              onClick={() => toggleProgram(p.id)}
            />
          ))}
        </Box>
      </Box>
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
