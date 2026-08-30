import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const emitEventMock = vi.fn()

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    reportIssue: vi.fn(),
  }
})

vi.mock('../../src/observability', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}))

import { reportIssue } from '../../src/api'
import ReportIssueModal, { AUTO_CLOSE_DELAY_MS } from '../../src/components/ReportIssueModal'

describe('ReportIssueModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    emitEventMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title and form elements when open', () => {
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)
    expect(screen.getByText('Send Feedback')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Feedback type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Problem or issue' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Comment or suggestion' })).not.toBeChecked()
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'feedback.report_issue_opened',
        action: 'open',
        outcome: 'success',
        page: 'browse',
      }),
    )
  })

  it('defaults feedback type to problem_or_issue', () => {
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)
    expect(screen.getByRole('radio', { name: 'Problem or issue' })).toBeChecked()
  })

  it('allows changing feedback type', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)

    await user.click(screen.getByRole('radio', { name: 'Comment or suggestion' }))
    expect(screen.getByRole('radio', { name: 'Comment or suggestion' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Problem or issue' })).not.toBeChecked()
  })

  it('submit button is disabled when description is empty', () => {
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('submit button is disabled when description is whitespace-only', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, '   ')
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('does not re-emit the opened event when props change while already open', () => {
    const { rerender } = render(<ReportIssueModal open onClose={vi.fn()} page="browse" />)
    expect(emitEventMock).toHaveBeenCalledTimes(1)

    rerender(<ReportIssueModal open onClose={vi.fn()} page="manage" />)
    expect(emitEventMock).toHaveBeenCalledTimes(1)
  })

  it('calls reportIssue with description, page_url and feedback_type', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'email',
      tracking_url: null,
      issue_url: null,
    })
    const onSuccess = vi.fn()
    render(<ReportIssueModal open onClose={vi.fn()} page="browse" onSuccess={onSuccess} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('radio', { name: 'Comment or suggestion' }))
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(reportIssue).toHaveBeenCalledWith({
        description: 'Button is broken',
        page_url: expect.any(String),
        feedback_type: 'comment_or_suggestion',
      })
    })
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'feedback.report_issue_submitted',
        action: 'submit',
        outcome: 'success',
        page: 'browse',
      }),
    )
    expect(onSuccess).toHaveBeenCalledWith('Thanks! Your feedback has been received.', null)
  })

  it('auto-closes after success once the auto-close delay elapses', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'teams',
      tracking_url: null,
      issue_url: null,
    })
    render(<ReportIssueModal open onClose={onClose} page="browse" onSuccess={onSuccess} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('Thanks! Your feedback has been received.', null)
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('passes a safe tracking URL to onSuccess and still auto-closes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'email',
      tracking_url: 'https://tracker.example/feedback/999',
      issue_url: null,
    })
    render(<ReportIssueModal open onClose={onClose} page="browse" onSuccess={onSuccess} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        'Thanks! Your feedback has been received.',
        'https://tracker.example/feedback/999',
      )
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores non-http(s) tracking URLs and passes null to onSuccess', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'email',
      tracking_url: 'javascript:alert(1)',
      issue_url: null,
    })
    render(<ReportIssueModal open onClose={onClose} page="browse" onSuccess={onSuccess} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('Thanks! Your feedback has been received.', null)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onError and keeps the modal open when reportIssue fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    const onError = vi.fn()
    vi.mocked(reportIssue).mockRejectedValue(new Error('Network error'))
    render(<ReportIssueModal open onClose={onClose} page="browse" onError={onError} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Some issue')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to send feedback. Please try again later.')
    })
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'feedback.report_issue_submitted',
        action: 'submit',
        outcome: 'failure',
        page: 'browse',
      }),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<ReportIssueModal open onClose={onClose} page="browse" />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cancelling after success clears the pending auto-close timer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.mocked(reportIssue).mockResolvedValue({
      destination: 'teams',
      tracking_url: null,
      issue_url: null,
    })
    render(<ReportIssueModal open onClose={onClose} page="browse" onSuccess={onSuccess} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CLOSE_DELAY_MS + 500)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
