import type { MeasurementUnit } from './api'

export const MEASUREMENT_UNITS: { value: MeasurementUnit; label: string }[] = [
  { value: 'um', label: 'µm' },
  { value: 'nm', label: 'nm' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
]

/** Display label for a stored `measurement_unit` (unknown values pass through). */
export function measurementUnitLabel(unit: string | null | undefined): string {
  if (!unit) return ''
  return MEASUREMENT_UNITS.find((u) => u.value === unit)?.label ?? unit
}
