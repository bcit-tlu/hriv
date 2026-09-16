import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RebuildJobsPanel, { type RebuildJobsPanelProps } from '../../src/components/RebuildJobsPanel'
import type { ApiJob, ApiJobItem, JobItemsPage } from '../../src/api'

function makeJob(overrides: Partial<ApiJob> = {}): ApiJob {
  return {
    id: 12,
    job_type: 'rebuild_tiles',
    status: 'running',
    progress: 42,
    total_count: 3400,
    completed_count: 1428,
    failed_count: 0,
    skipped_count: 68,
    cancelled_count: 0,
    queued_count: 1900,
    running_count: 4,
    error_message: null,
    metadata_extra: { scope: 'missing_stale' },
    requested_by: 1,
    started_at: '2026-09-10T14:32:00Z',
    completed_at: null,
    created_at: '2026-09-10T14:32:00Z',
    updated_at: '2026-09-10T14:32:00Z',
    ...overrides,
  }
}

function makeItem(overrides: Partial<ApiJobItem> = {}): ApiJobItem {
  return {
    id: 101,
    job_id: 11,
    resource_type: 'source_image',
    resource_id: '8801',
    status: 'failed',
    attempts: 3,
    progress: 0,
    error_message: 'vips: unable to read source image',
    heartbeat_at: null,
    lease_expires_at: null,
    retry_not_before: null,
    arq_job_id: null,
    metadata_extra: { image_id: 8801 },
    started_at: '2026-09-10T14:32:00Z',
    completed_at: '2026-09-10T14:32:00Z',
    created_at: '2026-09-10T14:32:00Z',
    updated_at: '2026-09-10T14:32:00Z',
    ...overrides,
  }
}

function defaultProps(overrides: Partial<RebuildJobsPanelProps> = {}): RebuildJobsPanelProps {
  return {
    jobs: [],
    capability: { enabled: true, parallelism: 4 },
    actionPending: null,
    onCancelJob: vi.fn(),
    onRetryFailedItems: vi.fn(async () => true),
    onRetryItem: vi.fn(async () => true),
    fetchFailedItems: vi.fn(async (): Promise<JobItemsPage> => ({
      items: [],
      next_after_id: null,
    })),
    ...overrides,
  }
}

describe('RebuildJobsPanel', () => {
  it('renders the empty state when there are no jobs', () => {
    render(<RebuildJobsPanel {...defaultProps()} />)
    expect(screen.getByText('No durable tile-rebuild jobs yet.')).toBeInTheDocument()
  })

  it('shows the disabled notice only when the capability reports disabled', () => {
    const { rerender } = render(
      <RebuildJobsPanel {...defaultProps({ capability: { enabled: false, parallelism: 0 } })} />,
    )
    expect(screen.getByTestId('parallel-rebuild-disabled-note')).toBeInTheDocument()

    rerender(<RebuildJobsPanel {...defaultProps({ capability: null })} />)
    expect(screen.queryByTestId('parallel-rebuild-disabled-note')).not.toBeInTheDocument()
  })

  it('renders job status chip, counts summary, and error message', () => {
    render(
      <RebuildJobsPanel
        {...defaultProps({
          jobs: [makeJob({ error_message: 'supervisor crashed' })],
        })}
      />,
    )
    expect(screen.getByTestId('rebuild-job-status-12')).toHaveTextContent('Running')
    expect(
      screen.getByText(/Queued 1900 · Running 4 · Completed 1428 · Skipped 68/),
    ).toBeInTheDocument()
    expect(screen.getByText('supervisor crashed')).toBeInTheDocument()
    expect(screen.getByText(/scope missing_stale/)).toBeInTheDocument()
  })

  it('calls onCancelJob for queued and running jobs only', async () => {
    const onCancelJob = vi.fn()
    const user = userEvent.setup()
    render(
      <RebuildJobsPanel
        {...defaultProps({
          onCancelJob,
          jobs: [
            makeJob({ id: 12, status: 'running' }),
            makeJob({ id: 13, status: 'cancelling' }),
            makeJob({ id: 14, status: 'completed', progress: 100 }),
          ],
        })}
      />,
    )

    expect(screen.getByTestId('cancel-rebuild-job-12')).toBeInTheDocument()
    expect(screen.queryByTestId('cancel-rebuild-job-13')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cancel-rebuild-job-14')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('cancel-rebuild-job-12'))
    expect(onCancelJob).toHaveBeenCalledWith(12)
  })

  it('lazily loads failed items on expand and appends later pages', async () => {
    const fetchFailedItems = vi.fn(async (_jobId: number, afterId?: number) =>
      afterId === undefined
        ? { items: [makeItem({ id: 101 }), makeItem({ id: 102 })], next_after_id: 102 }
        : { items: [makeItem({ id: 103 })], next_after_id: null },
    )
    const user = userEvent.setup()
    render(
      <RebuildJobsPanel
        {...defaultProps({
          fetchFailedItems,
          jobs: [makeJob({ id: 11, status: 'completed_with_errors', failed_count: 3 })],
        })}
      />,
    )

    await user.click(screen.getByTestId('failed-items-toggle-11'))
    expect(fetchFailedItems).toHaveBeenCalledWith(11, undefined)
    expect(await screen.findByTestId('rebuild-item-101')).toBeInTheDocument()
    expect(screen.getByTestId('rebuild-item-102')).toBeInTheDocument()

    await user.click(screen.getByTestId('failed-items-more-11'))
    expect(fetchFailedItems).toHaveBeenCalledWith(11, 102)
    expect(await screen.findByTestId('rebuild-item-103')).toBeInTheDocument()
    expect(screen.queryByTestId('failed-items-more-11')).not.toBeInTheDocument()
  })

  it('surfaces a failed-items fetch error inside the expanded section', async () => {
    const fetchFailedItems = vi.fn(async () => {
      throw new Error('network down')
    })
    const user = userEvent.setup()
    render(
      <RebuildJobsPanel
        {...defaultProps({
          fetchFailedItems,
          jobs: [makeJob({ id: 11, status: 'completed_with_errors', failed_count: 2 })],
        })}
      />,
    )

    await user.click(screen.getByTestId('failed-items-toggle-11'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('removes a failed item only when onRetryItem resolves true', async () => {
    const onRetryItem = vi.fn(async (_jobId: number, itemId: number) => itemId === 101)
    const user = userEvent.setup()
    render(
      <RebuildJobsPanel
        {...defaultProps({
          onRetryItem,
          fetchFailedItems: vi.fn(async () => ({
            items: [makeItem({ id: 101 }), makeItem({ id: 102 })],
            next_after_id: null,
          })),
          jobs: [makeJob({ id: 11, status: 'completed_with_errors', failed_count: 2 })],
        })}
      />,
    )

    await user.click(screen.getByTestId('failed-items-toggle-11'))
    await screen.findByTestId('rebuild-item-101')

    await user.click(screen.getByTestId('retry-item-101'))
    expect(onRetryItem).toHaveBeenCalledWith(11, 101)
    expect(screen.queryByTestId('rebuild-item-101')).not.toBeInTheDocument()
    expect(screen.getByTestId('rebuild-item-102')).toBeInTheDocument()

    await user.click(screen.getByTestId('retry-item-102'))
    expect(onRetryItem).toHaveBeenCalledWith(11, 102)
    expect(screen.getByTestId('rebuild-item-102')).toBeInTheDocument()
  })

  it('clears expanded failed items when onRetryFailedItems resolves true', async () => {
    const onRetryFailedItems = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <RebuildJobsPanel
        {...defaultProps({
          onRetryFailedItems,
          fetchFailedItems: vi.fn(async () => ({
            items: [makeItem({ id: 101 })],
            next_after_id: null,
          })),
          jobs: [makeJob({ id: 11, status: 'completed_with_errors', failed_count: 3 })],
        })}
      />,
    )

    await user.click(screen.getByTestId('failed-items-toggle-11'))
    await screen.findByTestId('rebuild-item-101')

    await user.click(screen.getByTestId('retry-failed-11'))
    expect(onRetryFailedItems).toHaveBeenCalledWith(11)
    expect(screen.queryByTestId('rebuild-item-101')).not.toBeInTheDocument()
  })

  it('hides the retry-failed button for cancelling, cancelled, and completed jobs', () => {
    render(
      <RebuildJobsPanel
        {...defaultProps({
          jobs: [
            makeJob({ id: 11, status: 'completed_with_errors', failed_count: 2 }),
            makeJob({ id: 12, status: 'cancelling', failed_count: 2 }),
            makeJob({ id: 13, status: 'cancelled', failed_count: 2 }),
            makeJob({ id: 14, status: 'completed', failed_count: 2 }),
          ],
        })}
      />,
    )

    expect(screen.getByTestId('retry-failed-11')).toBeInTheDocument()
    expect(screen.queryByTestId('retry-failed-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('retry-failed-13')).not.toBeInTheDocument()
    expect(screen.queryByTestId('retry-failed-14')).not.toBeInTheDocument()
  })
})
