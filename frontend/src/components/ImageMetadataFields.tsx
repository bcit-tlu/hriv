import { useCallback, useRef, useState } from 'react'
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
  const [programMenuOpen, setProgramMenuOpen] = useState(false)
  const ctrlHeld = useRef(false)

  const handleProgramChange = useCallback((event: SelectChangeEvent<number[]>) => {
    const val = event.target.value
    onChange({ ...values, programIds: typeof val === 'string' ? [] : val })
    if (!ctrlHeld.current) {
      setProgramMenuOpen(false)
    }
  }, [onChange, values])

  const handleItemMouseDown = useCallback((e: React.MouseEvent) => {
    ctrlHeld.current = e.ctrlKey || e.metaKey
  }, [])

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
          open={programMenuOpen}
          onOpen={() => setProgramMenuOpen(true)}
          onClose={() => setProgramMenuOpen(false)}
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
          <MenuItem disabled sx={{ fontStyle: 'italic', opacity: 0.7 }}>
            Hold Ctrl to select multiple programs
          </MenuItem>
          {programs.map((p) => (
            <MenuItem key={p.id} value={p.id} onMouseDown={handleItemMouseDown}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          Hold Ctrl and click to select multiple programs.
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
