import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ApiJob, ApiJobItem, JobItemsPage } from '../api'
import RebuildJobsPanel from './RebuildJobsPanel'

const FIXED_NOW = '2026-09-10T14:32:00Z'

function makeJob(overrides: Partial<ApiJob> = {}): ApiJob {
  return {
    id: 12,
    job_type: 'rebuild_tiles',
    status: 'running',
    progress: 0,
    total_count: 3400,
    completed_count: 0,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    queued_count: 3400,
    running_count: 0,
    error_message: null,
    metadata_extra: { scope: 'missing_stale' },
    requested_by: 1,
    started_at: FIXED_NOW,
    completed_at: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  }
}

function makeFailedItem(overrides: Partial<ApiJobItem> = {}): ApiJobItem {
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
    started_at: FIXED_NOW,
    completed_at: FIXED_NOW,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  }
}

const runningJob = makeJob({
  id: 12,
  status: 'running',
  progress: 42,
  queued_count: 1900,
  running_count: 4,
  completed_count: 1428,
  skipped_count: 68,
})

const completedJob = makeJob({
  id: 9,
  status: 'completed',
  progress: 100,
  queued_count: 0,
  completed_count: 3400,
  completed_at: '2026-09-10T15:47:12Z',
})

const completedWithErrorsJob = makeJob({
  id: 11,
  status: 'completed_with_errors',
  progress: 100,
  queued_count: 0,
  completed_count: 3397,
  failed_count: 3,
  completed_at: '2026-09-10T16:02:45Z',
})

const failedItemsPageOne: JobItemsPage = {
  items: [
    makeFailedItem({ id: 101, resource_id: '8801', metadata_extra: { image_id: 8801 } }),
    makeFailedItem({
      id: 102,
      resource_id: '8802',
      attempts: 2,
      error_message: 'tile pyramid swap failed: permission denied',
      metadata_extra: { image_id: 8802 },
    }),
  ],
  next_after_id: 102,
}

const failedItemsPageTwo: JobItemsPage = {
  items: [
    makeFailedItem({
      id: 103,
      resource_id: '8803',
      attempts: 1,
      error_message: 'source image missing from data volume',
      metadata_extra: { image_id: 8803 },
    }),
  ],
  next_after_id: null,
}

const meta = {
  title: 'Components/RebuildJobsPanel',
  component: RebuildJobsPanel,

  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Admin-page section listing durable parallel tile-rebuild jobs with progress, cancel/retry controls, and lazily loaded failed-item inspection.',
      },
    },
  },
  args: {
    jobs: [],
    capability: { enabled: true, parallelism: 4 },
    actionPending: null,
    onCancelJob: fn(),
    onRetryFailedItems: fn(async () => true),
    onRetryItem: fn(async () => true),
    fetchFailedItems: fn(async () => ({ items: [], next_after_id: null })),
  },
} satisfies Meta<typeof RebuildJobsPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    jobs: [runningJob, completedJob],
  },
}

export const CompletedWithErrorsExpanded: Story = {
  name: 'Completed With Errors — Failed Items Expanded',
  args: {
    jobs: [completedWithErrorsJob],
    fetchFailedItems: fn(async (_jobId: number, afterId?: number) =>
      afterId === undefined ? failedItemsPageOne : failedItemsPageTwo,
    ),
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByTestId('failed-items-toggle-11'))
    expect(await canvas.findByTestId('rebuild-item-101')).toBeVisible()
    expect(canvas.getByTestId('rebuild-item-102')).toBeVisible()

    await userEvent.click(canvas.getByTestId('failed-items-more-11'))
    expect(await canvas.findByTestId('rebuild-item-103')).toBeVisible()
    expect(canvas.queryByTestId('failed-items-more-11')).toBeNull()
  },
}

export const Cancelling: Story = {
  args: {
    jobs: [
      makeJob({
        id: 10,
        status: 'cancelling',
        progress: 55,
        queued_count: 700,
        running_count: 4,
        completed_count: 1870,
        cancelled_count: 826,
      }),
    ],
  },
}

export const CapabilityDisabled: Story = {
  name: 'Capability Disabled',
  args: {
    jobs: [completedJob],
    capability: { enabled: false, parallelism: 0 },
  },
}

export const Empty: Story = {
  args: {
    jobs: [],
  },
}
