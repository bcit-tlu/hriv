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

/** Common microscope objectives offered by the objective picker. */
export const MEASUREMENT_OBJECTIVES = ['4', '10', '20', '40', '50', '60', '100'] as const
export type MeasurementObjective = (typeof MEASUREMENT_OBJECTIVES)[number]

/** `"40"` → `"×40"`; empty for none. */
export function objectiveLabel(objective: string | null | undefined): string {
  return objective ? `×${objective}` : ''
}

/** Read `objective_power` (a number, e.g. 40) as a picker value; `''` when absent. */
export function objectiveFromMetadata(meta: Record<string, unknown> | null | undefined): string {
  const value = meta?.objective_power
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value)
  if (typeof value === 'string' && value.trim() && Number(value) > 0) return String(Number(value))
  return ''
}
