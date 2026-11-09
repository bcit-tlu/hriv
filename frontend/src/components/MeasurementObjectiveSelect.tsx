import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { MEASUREMENT_OBJECTIVES, objectiveLabel } from '../measurementUnits'

export interface MeasurementObjectiveSelectProps {
  /** Objective magnification as a string (e.g. `"40"`); `''` for none. */
  value: string
  onChange: (value: string) => void
  /** Visible label (dialogs). Omit in dense rows and pass `ariaLabel` instead. */
  label?: string
  /** Accessible-name suffix for unlabelled fields, e.g. the image name. */
  ariaLabel?: string
  helperText?: string
  size?: 'small' | 'medium'
  disabled?: boolean
}

/** Microscope objective picker, shared by Edit image and Measurement review. */
export default function MeasurementObjectiveSelect({
  value,
  onChange,
  label,
  ariaLabel,
  helperText,
  size = 'medium',
  disabled,
}: MeasurementObjectiveSelectProps) {
  // Keep unusual stored objectives (e.g. ×2.5 from a scanner) selectable.
  const legacy = value !== '' && !(MEASUREMENT_OBJECTIVES as readonly string[]).includes(value)
  return (
    <TextField
      select
      label={label}
      size={size}
      value={value}
      disabled={disabled}
      helperText={helperText}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        select: {
          displayEmpty: true,
          ...(ariaLabel
            ? { SelectDisplayProps: { 'aria-label': `Objective for ${ariaLabel}` } as object }
            : {}),
        },
        inputLabel: { shrink: true },
      }}
      sx={{ minWidth: size === 'small' ? 90 : 140 }}
    >
      <MenuItem value="">
        <em>None</em>
      </MenuItem>
      {MEASUREMENT_OBJECTIVES.map((o) => (
        <MenuItem key={o} value={o}>
          {objectiveLabel(o)}
        </MenuItem>
      ))}
      {legacy && <MenuItem value={value}>{objectiveLabel(value)}</MenuItem>}
    </TextField>
  )
}
