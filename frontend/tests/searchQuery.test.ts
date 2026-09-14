/**
 * Unit tests for parseSearchQuery — the search query tokenizer.
 *
 * Covers:
 * 1. Whitespace-separated bare terms (union baseline)
 * 2. "double quotes" group words into one exact-phrase clause
 * 3. Smart/curly double quotes behave like straight quotes
 * 4. Unclosed quotes treat the rest of the input as the phrase
 * 5. Empty quotes and lone quotes contribute no clause
 * 6. Mixed phrases and bare terms union together
 */

import { describe, it, expect } from 'vitest'
import { parseSearchQuery } from '../src/searchQuery'

describe('parseSearchQuery', () => {
  it('returns an empty list for empty or whitespace-only queries', () => {
    expect(parseSearchQuery('')).toEqual([])
    expect(parseSearchQuery('   ')).toEqual([])
  })

  it('splits bare terms on whitespace and lowercases them', () => {
    expect(parseSearchQuery('lung 2')).toEqual(['lung', '2'])
    expect(parseSearchQuery('Lung  2\tBiopsy')).toEqual(['lung', '2', 'biopsy'])
  })

  it('groups double-quoted words into a single phrase clause', () => {
    expect(parseSearchQuery('"lung 2"')).toEqual(['lung 2'])
    expect(parseSearchQuery('"Portal Triad"')).toEqual(['portal triad'])
  })

  it('treats smart double quotes like straight quotes', () => {
    expect(parseSearchQuery('“lung 2”')).toEqual(['lung 2'])
  })

  it('treats an unclosed quote as a phrase to the end of input', () => {
    expect(parseSearchQuery('"lung 2')).toEqual(['lung 2'])
    expect(parseSearchQuery('biopsy "lung 2')).toEqual(['biopsy', 'lung 2'])
  })

  it('unions mixed phrases and bare terms', () => {
    expect(parseSearchQuery('biopsy "lung 2" slide')).toEqual(['biopsy', 'lung 2', 'slide'])
  })

  it('collapses whitespace runs inside phrases', () => {
    expect(parseSearchQuery('"a   b"')).toEqual(['a b'])
    expect(parseSearchQuery('"  a b  "')).toEqual(['a b'])
  })

  it('ignores empty quotes and lone quote characters', () => {
    expect(parseSearchQuery('""')).toEqual([])
    expect(parseSearchQuery('"')).toEqual([])
    expect(parseSearchQuery('a "" b')).toEqual(['a', 'b'])
  })

  it('lets quotes act as clause boundaries without surrounding spaces', () => {
    expect(parseSearchQuery('a"b"c')).toEqual(['a', 'b', 'c'])
  })

  it('leaves single quotes as ordinary characters', () => {
    expect(parseSearchQuery("don't stop")).toEqual(["don't", 'stop'])
  })
})
