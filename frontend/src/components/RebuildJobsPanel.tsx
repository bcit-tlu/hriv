import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { userMessage } from '../api'
import type { ApiJob, ApiJobItem, JobItemsPage, RebuildTilesCapability } from '../api'

const REBUILD_JOB_STATUS_LABELS: Record<ApiJob['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
}

function rebuildJobStatusColor(
  status: ApiJob['status'],
): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'completed_with_errors':
    case 'cancelling':
    case 'cancelled':
      return 'warning'
    case 'running':
      return 'info'
    default:
      return 'default'
  }
}

// Source-image identity for a rebuild item: prefer the linked image id in
// item metadata, fall back to the source-image resource id.
function rebuildItemImageId(item: ApiJobItem): string {
  const imageId = item.metadata_extra?.image_id
  if (typeof imageId === 'number') return String(imageId)
  return item.resource_id ?? '?'
}

interface FailedItemsPageState {
  items: ApiJobItem[]
  nextAfterId: number | null
  loading: boolean
  error: string | null
}

export interface RebuildJobsPanelProps {
  jobs: ApiJob[]
  capability: RebuildTilesCapability | null
  // Mirrors the parent's pending-action marker ('cancel:<jobId>',
  // 'retry-failed:<jobId>', 'retry-item:<itemId>').
  actionPending: string | null
  onCancelJob: (jobId: number) => void
  // Resolve true when the mutation succeeded so the panel can drop its
  // now-stale local failed-items state.
  onRetryFailedItems: (jobId: number) => Promise<boolean>
  onRetryItem: (jobId: number, itemId: number) => Promise<boolean>
  fetchFailedItems: (jobId: number, afterId?: number) => Promise<JobItemsPage>
}

// Durable parallel tile-rebuild jobs (#1191) for the Admin page. The parent
// owns the jobs list, polling, capability probe, and mutations; this panel
// owns failed-item expansion and lazy pagination only.
export default function RebuildJobsPanel({
  jobs,
  capability,
  actionPending,
  onCancelJob,
  onRetryFailedItems,
  onRetryItem,
  fetchFailedItems,
}: RebuildJobsPanelProps) {
  const [expandedJobIds, setExpandedJobIds] = useState<Set<number>>(new Set())
  const [failedItems, setFailedItems] = useState<Record<number, FailedItemsPageState>>({})

  const loadFailedItems = async (jobId: number, afterId?: number) => {
    setFailedItems((prev) => ({
      ...prev,
      [jobId]: {
        items: prev[jobId]?.items ?? [],
        nextAfterId: prev[jobId]?.nextAfterId ?? null,
        loading: true,
        error: null,
      },
    }))
    try {
      const page = await fetchFailedItems(jobId, afterId)
      setFailedItems((prev) => ({
        ...prev,
        [jobId]: {
          items:
            afterId === undefined ? page.items : [...(prev[jobId]?.items ?? []), ...page.items],
          nextAfterId: page.next_after_id,
          loading: false,
          error: null,
        },
      }))
    } catch (err) {
      setFailedItems((prev) => ({
        ...prev,
        [jobId]: {
          items: prev[jobId]?.items ?? [],
          nextAfterId: prev[jobId]?.nextAfterId ?? null,
          loading: false,
          error: userMessage(err, 'Failed to load failed items'),
        },
      }))
    }
  }

  const toggleFailedItems = (jobId: number) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) {
        next.delete(jobId)
      } else {
        next.add(jobId)
      }
      return next
    })
    if (!expandedJobIds.has(jobId) && failedItems[jobId] === undefined) {
      void loadFailedItems(jobId)
    }
  }

  const handleRetryFailedItems = async (jobId: number) => {
    if (!(await onRetryFailedItems(jobId))) return
    // Everything failed was requeued — the failed-items list is stale.
    setFailedItems((prev) => {
      if (!(jobId in prev)) return prev
      const next = { ...prev }
      delete next[jobId]
      return next
    })
    setExpandedJobIds((prev) => {
      const next = new Set(prev)
      next.delete(jobId)
      return next
    })
  }

  const handleRetryItem = async (jobId: number, itemId: number) => {
    if (!(await onRetryItem(jobId, itemId))) return
    // The requeued item no longer belongs in the failed list.
    setFailedItems((prev) => {
      const page = prev[jobId]
      if (!page) return prev
      return {
        ...prev,
        [jobId]: { ...page, items: page.items.filter((i) => i.id !== itemId) },
      }
    })
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Parallel tile rebuilds
      </Typography>
      {capability?.enabled === false && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="parallel-rebuild-disabled-note">
          Parallel rebuilds are disabled in this environment — the Rebuild Tiles button uses the
          serial task runner. Durable jobs listed below still run to completion.
        </Alert>
      )}
      {jobs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No durable tile-rebuild jobs yet.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {jobs.map((job) => {
            const failedPage = failedItems[job.id]
            const failedExpanded = expandedJobIds.has(job.id)
            const retryable =
              job.failed_count > 0 &&
              job.status !== 'cancelling' &&
              job.status !== 'cancelled' &&
              job.status !== 'completed'
            return (
              <Box
                key={job.id}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 2,
                  bgcolor: 'background.paper',
                }}
                data-testid={`rebuild-job-${job.id}`}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    flexWrap: 'wrap',
                  }}
                >
                  <Chip
                    size="small"
                    label={REBUILD_JOB_STATUS_LABELS[job.status] ?? job.status}
                    color={rebuildJobStatusColor(job.status)}
                    sx={{ minWidth: 80 }}
                    data-testid={`rebuild-job-status-${job.id}`}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Rebuild job #{job.id}
                    {typeof job.metadata_extra?.scope === 'string' &&
                      ` · scope ${job.metadata_extra.scope}`}
                    {' · '}
                    {new Date(job.created_at).toLocaleString()}
                  </Typography>
                  {(job.status === 'queued' || job.status === 'running') && (
                    <Button
                      size="small"
                      color="warning"
                      variant="outlined"
                      disabled={actionPending === `cancel:${job.id}`}
                      onClick={() => onCancelJob(job.id)}
                      data-testid={`cancel-rebuild-job-${job.id}`}
                    >
                      {actionPending === `cancel:${job.id}` ? 'Cancelling…' : 'Cancel'}
                    </Button>
                  )}
                  {retryable && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={actionPending === `retry-failed:${job.id}`}
                      onClick={() => void handleRetryFailedItems(job.id)}
                      data-testid={`retry-failed-${job.id}`}
                    >
                      Retry {job.failed_count} failed
                    </Button>
                  )}
                </Box>
                <LinearProgress variant="determinate" value={job.progress} sx={{ mt: 1 }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.5, display: 'block' }}
                >
                  {`Queued ${job.queued_count} · Running ${job.running_count} · Completed ${job.completed_count} · Skipped ${job.skipped_count} · Failed ${job.failed_count} · Cancelled ${job.cancelled_count} · ${job.progress}%`}
                </Typography>
                {job.error_message && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {job.error_message}
                  </Alert>
                )}
                {job.failed_count > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      onClick={() => toggleFailedItems(job.id)}
                      data-testid={`failed-items-toggle-${job.id}`}
                    >
                      {failedExpanded ? 'Hide' : 'Show'} failed items ({job.failed_count})
                    </Button>
                    {failedExpanded && (
                      <Box
                        sx={{
                          mt: 1,
                          borderTop: 1,
                          borderColor: 'divider',
                          pt: 1,
                        }}
                      >
                        {failedPage?.error && (
                          <Alert severity="error" sx={{ mb: 1 }}>
                            {failedPage.error}
                          </Alert>
                        )}
                        {failedPage === undefined || failedPage.loading ? (
                          <CircularProgress size={20} />
                        ) : failedPage.items.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            No failed items remain.
                          </Typography>
                        ) : (
                          failedPage.items.map((item) => (
                            <Box
                              key={item.id}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                py: 0.5,
                              }}
                              data-testid={`rebuild-item-${item.id}`}
                            >
                              <Typography variant="body2" sx={{ minWidth: 90 }}>
                                Image #{rebuildItemImageId(item)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                                {item.error_message ?? 'Failed'} · {item.attempts}{' '}
                                {item.attempts === 1 ? 'attempt' : 'attempts'}
                              </Typography>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={actionPending === `retry-item:${item.id}`}
                                onClick={() => void handleRetryItem(job.id, item.id)}
                                data-testid={`retry-item-${item.id}`}
                              >
                                Retry
                              </Button>
                            </Box>
                          ))
                        )}
                        {failedPage !== undefined &&
                          !failedPage.loading &&
                          failedPage.nextAfterId !== null && (
                            <Button
                              size="small"
                              onClick={() =>
                                void loadFailedItems(job.id, failedPage.nextAfterId ?? undefined)
                              }
                              data-testid={`failed-items-more-${job.id}`}
                            >
                              Load more
                            </Button>
                          )}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
