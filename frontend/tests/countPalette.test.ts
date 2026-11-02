import { describe, it, expect } from 'vitest'
import { COUNT_GROUP_PALETTE, countGroupColor, countGroupLabel } from '../src/countPalette'

describe('countPalette', () => {
  it('uses the Okabe–Ito palette', () => {
    expect(COUNT_GROUP_PALETTE).toEqual([
      '#0072B2',
      '#E69F00',
      '#009E73',
      '#CC79A7',
      '#56B4E9',
      '#D55E00',
      '#F0E442',
    ])
  })

  it('maps groups deterministically and wraps modulo', () => {
    expect(countGroupColor(0)).toBe('#0072B2')
    expect(countGroupColor(6)).toBe('#F0E442')
    expect(countGroupColor(7)).toBe(countGroupColor(0))
    expect(countGroupColor(9)).toBe(countGroupColor(2))
    expect(countGroupColor(-1)).toBe('#F0E442')
  })

  it('labels groups as "Group n" starting at 1', () => {
    expect(countGroupLabel(0)).toBe('Group 1')
    expect(countGroupLabel(2)).toBe('Group 3')
  })
})
