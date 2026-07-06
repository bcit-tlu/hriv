import { describe, expect, it } from 'vitest'
import { hasFilterTerms, matchesTextFilter } from '../src/tableFilterUtils'

describe('matchesTextFilter', () => {
  it('detects whether a filter has any real terms', () => {
    expect(hasFilterTerms('')).toBe(false)
    expect(hasFilterTerms('   ')).toBe(false)
    expect(hasFilterTerms(' , , ')).toBe(false)
    expect(hasFilterTerms('blood')).toBe(true)
    expect(hasFilterTerms('blood, ')).toBe(true)
  })

  it('matches a single term', () => {
    expect(matchesTextFilter('Blood Smear', 'smear')).toBe(true)
    expect(matchesTextFilter('Blood Smear', 'urine')).toBe(false)
  })

  it('matches any comma-separated term', () => {
    expect(matchesTextFilter('Blood Smear', 'urine, smear')).toBe(true)
    expect(matchesTextFilter('Blood Smear', 'urine, sputum')).toBe(false)
  })

  it('trims whitespace around comma-separated terms', () => {
    expect(matchesTextFilter('Blood Smear', '  blood ,  urine ')).toBe(true)
  })

  it('treats empty and comma-only filters as match-all', () => {
    expect(matchesTextFilter('Blood Smear', '')).toBe(true)
    expect(matchesTextFilter('Blood Smear', ' , ,, ')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchesTextFilter('Blood Smear', 'BLOOD')).toBe(true)
  })
})
