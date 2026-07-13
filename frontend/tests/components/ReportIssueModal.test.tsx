import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    reportIssue: vi.fn(),
  }
})

import { reportIssue } from '../../src/api'
import ReportIssueModal, { AUTO_CLOSE_DELAY_MS } from '../../src/components/ReportIssueModal'

describe('ReportIssueModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title and form elements when open', () => {
    render(<ReportIssueModal open onClose={vi.fn()} />)
    expect(screen.getByText('Report an Issue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it('submit button is disabled when description is empty', () => {
    render(<ReportIssueModal open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('submit button is disabled when description is whitespace-only', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, '   ')
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('calls reportIssue and shows success message', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'github',
      tracking_url: 'https://github.com/...',
      issue_url: 'https://github.com/...',
    })
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/Your feedback was received successfully/)).toBeInTheDocument()
    })
    expect(reportIssue).toHaveBeenCalledWith({
      description: 'Button is broken',
      page_url: expect.any(String),
    })
  })

  it('shows error message when reportIssue fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(reportIssue).mockRejectedValue(new Error('Network error'))
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Some issue')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText('Failed to submit report.')).toBeInTheDocument()
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<ReportIssueModal open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('auto-closes after success once the auto-close delay elapses', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'github',
      tracking_url: 'https://github.com/...',
      issue_url: 'https://github.com/...',
    })
    render(<ReportIssueModal open onClose={onClose} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/Your feedback was received successfully/)).toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cancelling after success clears the pending auto-close timer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'github',
      tracking_url: 'https://github.com/...',
      issue_url: 'https://github.com/...',
    })
    render(<ReportIssueModal open onClose={onClose} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/Your feedback was received successfully/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
