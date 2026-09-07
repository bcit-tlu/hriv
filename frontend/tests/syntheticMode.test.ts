import { beforeEach, describe, expect, it } from 'vitest'

import { getClientSyntheticMode, setClientSyntheticMode } from '../src/syntheticMode'

describe('syntheticMode', () => {
  beforeEach(() => {
    setClientSyntheticMode(false)
  })

  it('defaults to false', () => {
    expect(getClientSyntheticMode()).toBe(false)
  })

  it('reflects explicitly enabled state', () => {
    setClientSyntheticMode(true)
    expect(getClientSyntheticMode()).toBe(true)
  })

  it('reflects explicitly disabled state', () => {
    setClientSyntheticMode(true)
    setClientSyntheticMode(false)
    expect(getClientSyntheticMode()).toBe(false)
  })
})
