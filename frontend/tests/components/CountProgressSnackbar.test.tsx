/**
 * CountProgressSnackbar (#1667): progress captions, multi-job caption,
 * error severities/messages, Retry action, aria-live.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CountProgressSnackbar from '../../src/components/CountProgressSnackbar'
import { countErrorMessage, countErrorRetryable, countErrorSeverity } from '../../src/countingUi'
import type { CountErrorCode, SelectionCountEntry } from '../../src/useSelectionCounts'

const SEL = { x: 0, y: 0, width: 10, height: 10 }

function entry(partial: Partial<SelectionCountEntry>): SelectionCountEntry {
  return {
    key: 'sel-1',
    label: 'Selection 2',
    mode: 'cells',
    selection: SEL,
    phase: 'running',
    queuePosition: null,
    jobId: 'j1',
    ...partial,
  }
}

function renderBar(overrides: Partial<Parameters<typeof CountProgressSnackbar>[0]> = {}) {
  const props = {
    activeEntries: [] as SelectionCountEntry[],
    errorEntry: null,
    onCancelActive: vi.fn(),
    onDismissError: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
  render(<CountProgressSnackbar {...props} />)
  return props
}

describe('CountProgressSnackbar', () => {
  it('shows the running caption for one active job', () => {
    renderBar({ activeEntries: [entry({})] })
    expect(screen.getByText('Counting objects')).toBeInTheDocument()
    expect(
      screen.getByText('Selection 2 · Objects — finding and outlining objects…'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the queued caption with the queue position', () => {
    renderBar({
      activeEntries: [entry({ phase: 'queued', queuePosition: 3 })],
    })
    expect(
      screen.getByText('Selection 2 · Objects — waiting in queue (3 ahead)'),
    ).toBeInTheDocument()
  })

  it('collapses multiple active jobs into one caption', () => {
    renderBar({
      activeEntries: [entry({}), entry({ key: 'sel-2' })],
    })
    expect(screen.getByText('Counting objects in 2 selections')).toBeInTheDocument()
  })

  it('Cancel calls onCancelActive', async () => {
    const user = userEvent.setup()
    const props = renderBar({ activeEntries: [entry({})] })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancelActive).toHaveBeenCalled()
  })

  it.each<[CountErrorCode, string, 'warning' | 'error', boolean]>([
    ['too_large', 'Selection too large — draw a smaller box or zoom in.', 'warning', false],
    ['rate_limited', 'You already have counts running. Wait for one to finish.', 'warning', false],
    ['unavailable', 'Object counting is unavailable right now. Try again later.', 'error', false],
    ['tiles_not_ready', "This image can't be counted yet.", 'error', false],
    ['invalid_selection', 'Draw the selection over the image.', 'error', false],
    ['too_many_objects', 'Too many objects to count — draw a smaller box.', 'warning', false],
    ['expired', 'Count results expired. Count again.', 'warning', false],
    ['timeout', 'Counting failed.', 'error', true],
    ['no_tiles', 'Counting failed.', 'error', true],
    ['internal', 'Counting failed.', 'error', true],
  ])('error %s -> "%s" (%s, retry=%s)', (code, message, severity, retryable) => {
    expect(countErrorMessage(code)).toBe(message)
    expect(countErrorSeverity(code)).toBe(severity)
    expect(countErrorRetryable(code)).toBe(retryable)
  })

  it('renders a Retry action for retryable errors', async () => {
    const user = userEvent.setup()
    const failed = entry({ phase: 'failed', error: 'timeout' })
    const props = renderBar({ errorEntry: failed })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalledWith(failed)
  })

  it('renders no Retry for non-retryable errors and Close dismisses', async () => {
    const user = userEvent.setup()
    const failed = entry({ phase: 'failed', error: 'too_large' })
    const props = renderBar({ errorEntry: failed })
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onDismissError).toHaveBeenCalledWith('sel-1')
  })
})
