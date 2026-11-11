import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_INPUT_FORMAT,
  expiryShortcuts,
  publishShortcuts,
  rangeShortcuts,
  toPickerValue,
} from '../src/announcementSchedule'

const now = dayjs('2026-11-11T15:42:30') // a Wednesday

function pick(items: ReturnType<typeof publishShortcuts>, label: string) {
  const item = items.find((i) => i.label === label)
  if (!item) throw new Error(`missing shortcut ${label}`)
  return item.getValue({ isValid: () => true })
}

describe('toPickerValue', () => {
  it('formats valid values as datetime-local strings and empties invalid ones', () => {
    expect(toPickerValue(dayjs('2030-05-01T09:05:59'))).toBe('2030-05-01T09:05')
    expect(toPickerValue(null)).toBe('')
    expect(toPickerValue(dayjs('not a date'))).toBe('')
  })
})

describe('publishShortcuts', () => {
  it('offers now, tomorrow morning and next Monday morning', () => {
    const items = publishShortcuts(now)
    expect(items.map((i) => i.label)).toEqual(['Now', 'Tomorrow 9:00', 'Next Monday 9:00'])
    expect(pick(items, 'Now')?.format(LOCAL_INPUT_FORMAT)).toBe('2026-11-11T15:42')
    expect(pick(items, 'Tomorrow 9:00')?.format(LOCAL_INPUT_FORMAT)).toBe('2026-11-12T09:00')
    expect(pick(items, 'Next Monday 9:00')?.format(LOCAL_INPUT_FORMAT)).toBe('2026-11-16T09:00')
  })

  it('skips to the following week when today is Monday', () => {
    const monday = dayjs('2026-11-16T08:00:00')
    expect(pick(publishShortcuts(monday), 'Next Monday 9:00')?.format('YYYY-MM-DD')).toBe(
      '2026-11-23',
    )
  })
})

describe('expiryShortcuts', () => {
  it('measures from the publish time when one is set', () => {
    const items = expiryShortcuts('2030-05-01T09:00', now)
    expect(items.map((i) => i.label)).toEqual([
      '1 day',
      '1 week',
      '2 weeks',
      '1 month',
      'End of month',
    ])
    expect(pick(items, '1 day')?.format(LOCAL_INPUT_FORMAT)).toBe('2030-05-02T09:00')
    expect(pick(items, '2 weeks')?.format(LOCAL_INPUT_FORMAT)).toBe('2030-05-15T09:00')
    expect(pick(items, '1 month')?.format(LOCAL_INPUT_FORMAT)).toBe('2030-06-01T09:00')
    expect(pick(items, 'End of month')?.format(LOCAL_INPUT_FORMAT)).toBe('2030-05-31T23:59')
  })

  it('End of month rolls over when the publish time is already past 23:59 on the last day', () => {
    const items = expiryShortcuts('2030-05-31T23:59', now)
    expect(pick(items, 'End of month')?.format(LOCAL_INPUT_FORMAT)).toBe('2030-06-30T23:59')
  })

  it('falls back to now when the publish time is empty or invalid', () => {
    expect(pick(expiryShortcuts('', now), '1 week')?.format(LOCAL_INPUT_FORMAT)).toBe(
      '2026-11-18T15:42',
    )
    expect(pick(expiryShortcuts('garbage', now), '1 day')?.format(LOCAL_INPUT_FORMAT)).toBe(
      '2026-11-12T15:42',
    )
  })
})

describe('rangeShortcuts', () => {
  it('spans publish → expiry: today/this week start now, future spans start at 9:00, all end 23:59', () => {
    const now = dayjs('2026-11-11T14:30') // a Wednesday
    const byLabel = Object.fromEntries(rangeShortcuts(now).map((r) => [r.label, r]))
    expect(Object.keys(byLabel)).toEqual([
      'Today',
      'This week',
      'Next week',
      'Next 2 weeks',
      'End of month',
      'Next month',
    ])
    expect(byLabel['Today']).toMatchObject({
      publishAt: '2026-11-11T14:30',
      expiresAt: '2026-11-11T23:59',
    })
    expect(byLabel['This week'].expiresAt).toBe('2026-11-15T23:59')
    expect(byLabel['Next week']).toMatchObject({
      publishAt: '2026-11-16T09:00',
      expiresAt: '2026-11-22T23:59',
    })
    expect(byLabel['Next 2 weeks'].expiresAt).toBe('2026-11-24T23:59')
    expect(byLabel['End of month'].expiresAt).toBe('2026-11-30T23:59')
    expect(byLabel['Next month']).toMatchObject({
      publishAt: '2026-12-01T09:00',
      expiresAt: '2026-12-31T23:59',
    })
  })
})
