import type { ApiMeasurementFinding } from './api'

/** One-line evidence summary: the detector's reason, or what it measured. */
export function evidenceSummary(finding: ApiMeasurementFinding): string {
  const evidence = finding.evidence ?? {}
  if (typeof evidence.reason === 'string') return evidence.reason.replace(/_/g, ' ')
  const parts: string[] = []
  if (typeof evidence.rbc_diameter_px === 'number') {
    parts.push(`RBC ⌀ ${evidence.rbc_diameter_px.toFixed(1)} px`)
  }
  if (typeof evidence.rbc_selected === 'number') {
    parts.push(`${evidence.rbc_selected} cells`)
  }
  return parts.join(' · ') || '—'
}
