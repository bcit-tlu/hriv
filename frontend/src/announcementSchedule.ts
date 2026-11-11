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
