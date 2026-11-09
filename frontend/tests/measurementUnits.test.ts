import { describe, it, expect } from 'vitest'
import { objectiveFromMetadata, objectiveLabel } from '../src/measurementUnits'

describe('objectiveLabel', () => {
  it.each([
    ['40', '×40'],
    ['2.5', '×2.5'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%s → %s', (input, expected) => {
    expect(objectiveLabel(input)).toBe(expected)
  })
})

describe('objectiveFromMetadata', () => {
  it.each([
    [{ objective_power: 40 }, '40'],
    [{ objective_power: 40.0 }, '40'],
    [{ objective_power: 2.5 }, '2.5'],
    [{ objective_power: ' 20 ' }, '20'],
    [{ objective_power: '40.0' }, '40'],
    [{ objective_power: 0 }, ''],
    [{ objective_power: -10 }, ''],
    [{ objective_power: Number.NaN }, ''],
    [{ objective_power: 'abc' }, ''],
    [{ objective_power: '' }, ''],
    [{ objective_power: true }, ''],
    [{}, ''],
    [null, ''],
    [undefined, ''],
  ])('%j → %j', (meta, expected) => {
    expect(objectiveFromMetadata(meta)).toBe(expected)
  })
})
