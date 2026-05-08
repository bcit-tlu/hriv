import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    reportIssue: vi.fn(),
  }
})

import { reportIssue } from '../../src/api'
import ReportIssueModal from '../../src/components/ReportIssueModal'

describe('ReportIssueModal', () => {
  beforeEach(() => vi.clearAllMocks())

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
    const user = userEvent.setup()
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, '   ')
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('calls reportIssue and shows success message', async () => {
    const user = userEvent.setup()
    vi.mocked(reportIssue).mockResolvedValue({ issue_url: 'https://github.com/...' })
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Button is broken')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/Issue created successfully/)).toBeInTheDocument()
    })
    expect(reportIssue).toHaveBeenCalledWith({
      description: 'Button is broken',
      page_url: expect.any(String),
    })
  })

  it('shows error message when reportIssue fails', async () => {
    const user = userEvent.setup()
    vi.mocked(reportIssue).mockRejectedValue(new Error('Network error'))
    render(<ReportIssueModal open onClose={vi.fn()} />)

    const textfield = screen.getByRole('textbox')
    await user.type(textfield, 'Some issue')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReportIssueModal open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
