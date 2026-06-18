import { describe, expect, it } from 'vitest'
import {
  INHERITED_RESTRICTION_OPACITY,
  getInheritedRestrictionOpacity,
  getInheritedRestrictionSx,
} from '../src/restrictionStyles'

describe('restrictionStyles', () => {
  it('exports the shared inherited restriction opacity constant', () => {
    expect(INHERITED_RESTRICTION_OPACITY).toBe(0.6)
  })

  it('returns full opacity for direct restrictions and reduced opacity for inherited ones', () => {
    expect(getInheritedRestrictionOpacity(false)).toBe(1)
    expect(getInheritedRestrictionOpacity(true)).toBe(0.6)
  })

  it('adds the shared opacity to inherited sx styles', () => {
    expect(getInheritedRestrictionSx(true)).toEqual({ opacity: 0.6 })
    expect(getInheritedRestrictionSx(true, { cursor: 'pointer' })).toEqual([
      { opacity: 0.6 },
      { cursor: 'pointer' },
    ])
    expect(getInheritedRestrictionSx(false, { cursor: 'pointer' })).toEqual({ cursor: 'pointer' })
  })
})
