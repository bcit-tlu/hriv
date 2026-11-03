import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { MEASUREMENT_UNITS } from '../measurementUnits'

export interface MeasurementScaleFieldsProps {
  scale: string
  unit: string
  onScaleChange: (value: string) => void
  onUnitChange: (value: string) => void
  /** Visible labels (dialogs). Omit in dense rows and pass `ariaLabel` instead. */
  scaleLabel?: string
  unitLabel?: string
  /** Accessible-name suffix for unlabelled fields, e.g. the image name. */
  ariaLabel?: string
  scaleHelperText?: string
  unitHelperText?: string
  placeholder?: string
  error?: boolean
  /** Offer "None" so an existing unit can be cleared. */
  allowEmptyUnit?: boolean
  size?: 'small' | 'medium'
  disabled?: boolean
}

/** Scale (px per unit) number field plus unit picker, shared by Edit image and Measurement review. */
export default function MeasurementScaleFields({
  scale,
  unit,
  onScaleChange,
  onUnitChange,
  scaleLabel,
  unitLabel,
  ariaLabel,
  scaleHelperText,
  unitHelperText,
  placeholder,
  error,
  allowEmptyUnit = false,
  size = 'medium',
  disabled,
}: MeasurementScaleFieldsProps) {
  // Keep legacy free-text units selectable instead of silently dropping them.
  const legacy = unit !== '' && !MEASUREMENT_UNITS.some((u) => u.value === unit)
  return (
    <Stack direction="row" spacing={size === 'small' ? 1 : 2} sx={{ width: '100%' }}>
      <TextField
        label={scaleLabel}
        type="number"
        size={size}
        value={scale}
        placeholder={placeholder}
        error={error}
        disabled={disabled}
        helperText={scaleHelperText}
        onChange={(e) => onScaleChange(e.target.value)}
        slotProps={{
          htmlInput: {
            min: 0,
            step: 'any',
            ...(ariaLabel ? { 'aria-label': `Scale for ${ariaLabel}` } : {}),
          },
        }}
        // Wide enough that the spinner arrows never cover the value.
        sx={{ flex: 2, minWidth: size === 'small' ? 140 : 180 }}
      />
      <TextField
        select
        label={unitLabel}
        size={size}
        value={unit}
        disabled={disabled}
        helperText={unitHelperText}
        onChange={(e) => onUnitChange(e.target.value)}
        slotProps={{
          select: {
            displayEmpty: allowEmptyUnit,
            ...(ariaLabel
              ? { SelectDisplayProps: { 'aria-label': `Unit for ${ariaLabel}` } as object }
              : {}),
          },
          inputLabel: allowEmptyUnit ? { shrink: true } : undefined,
        }}
        sx={{ flex: 1, minWidth: 90 }}
      >
        {allowEmptyUnit && (
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
        )}
        {MEASUREMENT_UNITS.map((u) => (
          <MenuItem key={u.value} value={u.value}>
            {u.label}
          </MenuItem>
        ))}
        {legacy && <MenuItem value={unit}>{unit}</MenuItem>}
      </TextField>
    </Stack>
  )
}
