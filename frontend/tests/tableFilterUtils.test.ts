import { describe, expect, it } from 'vitest'
import {
  formatFilterTerms,
  getFilterTerms,
  hasFilterTerms,
  matchesTextFilter,
  removeFilterTerm,
} from '../src/tableFilterUtils'

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

  it('matches every comma-separated term', () => {
    expect(matchesTextFilter('Blood Smear', 'blood, smear')).toBe(true)
    expect(matchesTextFilter('Blood Smear', 'urine, smear')).toBe(false)
    expect(matchesTextFilter('Blood Smear', 'blood, urine')).toBe(false)
  })

  it('trims whitespace around comma-separated terms', () => {
    expect(matchesTextFilter('Blood Urine Smear', '  blood ,  urine ')).toBe(true)
    expect(matchesTextFilter('Blood Smear', '  blood ,  urine ')).toBe(false)
  })

  it('treats empty and comma-only filters as match-all', () => {
    expect(matchesTextFilter('Blood Smear', '')).toBe(true)
    expect(matchesTextFilter('Blood Smear', ' , ,, ')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchesTextFilter('Blood Smear', 'BLOOD')).toBe(true)
  })
})

describe('formatFilterTerms', () => {
  it('drops empty terms and trailing commas while preserving case and order', () => {
    expect(formatFilterTerms('blood,')).toBe('blood')
    expect(formatFilterTerms('blood, ,')).toBe('blood')
    expect(formatFilterTerms('  Blood , Urine ')).toBe('Blood, Urine')
    expect(formatFilterTerms(' , , ')).toBe('')
  })
})

describe('getFilterTerms', () => {
  it('drops empty terms and dedupes case-insensitively while preserving first casing', () => {
    expect(getFilterTerms(' Blood, blood, URINE, urine, , ')).toEqual(['Blood', 'URINE'])
    expect(getFilterTerms('apple, banana, apple')).toEqual(['apple', 'banana'])
  })
})

describe('removeFilterTerm', () => {
  it('removes matching terms case-insensitively and rejoins with commas', () => {
    expect(removeFilterTerm('Blood, Urine, smear', 'urine')).toBe('Blood, smear')
    expect(removeFilterTerm('Blood, Urine, smear', 'SMEAR')).toBe('Blood, Urine')
  })

  it('handles trailing commas and empty terms', () => {
    expect(removeFilterTerm('Blood, Urine,', 'blood')).toBe('Urine')
    expect(removeFilterTerm(' , Blood , , Urine ', 'blood')).toBe('Urine')
  })
})
