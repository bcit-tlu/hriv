import dayjs, { type Dayjs } from 'dayjs'
import type { PickersShortcutsItem } from '@mui/x-date-pickers/PickersShortcuts'

/** Composer schedule fields keep the `datetime-local` string shape (`YYYY-MM-DDTHH:mm`). */
export const LOCAL_INPUT_FORMAT = 'YYYY-MM-DDTHH:mm'
/** What the picker text field shows/accepts. */
export const PICKER_FORMAT = 'YYYY-MM-DD HH:mm'

export function toPickerValue(value: Dayjs | null): string {
  return value && value.isValid() ? value.format(LOCAL_INPUT_FORMAT) : ''
}

function atNine(day: Dayjs): Dayjs {
  return day.hour(9).minute(0).second(0).millisecond(0)
}

function nextMonday(from: Dayjs): Dayjs {
  const daysAhead = (8 - from.day()) % 7 || 7
  return atNine(from.add(daysAhead, 'day'))
}

/** Quick picks for "Publish at": now, tomorrow morning, next Monday morning. */
export function publishShortcuts(now: Dayjs = dayjs()): PickersShortcutsItem<Dayjs | null>[] {
  return [
    { label: 'Now', getValue: () => now },
    { label: 'Tomorrow 9:00', getValue: () => atNine(now.add(1, 'day')) },
    { label: 'Next Monday 9:00', getValue: () => nextMonday(now) },
  ]
}

/**
 * Quick picks for "Expires at", relative to the publish time when one is set
 * (so "1 week" means a one-week run), otherwise relative to now.
 */
/** 23:59 on the last day of `start`'s month, or of the next month when that is not after `start`. */
function endOfMonthAfter(start: Dayjs): Dayjs {
  const eom = start.endOf('month').second(0).millisecond(0)
  return eom.isAfter(start) ? eom : start.add(1, 'month').endOf('month').second(0).millisecond(0)
}

export function expiryShortcuts(
  publishAt: string,
  now: Dayjs = dayjs(),
): PickersShortcutsItem<Dayjs | null>[] {
  const start = publishAt && dayjs(publishAt).isValid() ? dayjs(publishAt) : now
  return [
    { label: '1 day', getValue: () => start.add(1, 'day') },
    { label: '1 week', getValue: () => start.add(1, 'week') },
    { label: '2 weeks', getValue: () => start.add(2, 'week') },
    { label: '1 month', getValue: () => start.add(1, 'month') },
    { label: 'End of month', getValue: () => endOfMonthAfter(start) },
  ]
}

export interface RangeShortcut {
  label: string
  publishAt: string
  expiresAt: string
}

function endOfDay(day: Dayjs): Dayjs {
  return day.endOf('day').second(0).millisecond(0)
}

/** 23:59 on the Sunday that ends `day`'s week (Monday-first). */
function endOfWeek(day: Dayjs): Dayjs {
  const daysAhead = (7 - day.day()) % 7
  return endOfDay(day.add(daysAhead, 'day'))
}

/**
 * Whole publish→expiry spans, shown as chips above both pickers. Spans that start today
 * publish now; future spans publish at 9:00 on their first day. Each ends at 23:59.
 */
export function rangeShortcuts(now: Dayjs = dayjs()): RangeShortcut[] {
  const range = (label: string, start: Dayjs, end: Dayjs): RangeShortcut => ({
    label,
    publishAt: toPickerValue(start),
    expiresAt: toPickerValue(end),
  })
  const monday = nextMonday(now)
  const firstOfNextMonth = atNine(now.add(1, 'month').startOf('month'))
  return [
    range('Today', now, endOfDay(now)),
    range('This week', now, endOfWeek(now)),
    range('Next week', monday, endOfWeek(monday)),
    range('Next 2 weeks', now, endOfDay(now.add(13, 'day'))),
    range('End of month', now, endOfMonthAfter(now)),
    range('Next month', firstOfNextMonth, endOfDay(firstOfNextMonth.endOf('month'))),
  ]
}
