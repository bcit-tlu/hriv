import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import Divider from '@mui/material/Divider'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import {
  approveMeasurementFinding,
  bulkApproveMeasurementFindings,
  fetchImage,
  fetchMeasurementFindingCategories,
  fetchMeasurementFindings,
  fetchMeasurementScanProgress,
  fetchMeasurementScanRemaining,
  previewMeasurementFinding,
  rejectMeasurementFinding,
  resetMeasurementFinding,
  scanMeasurements,
  updateMeasurementFindingParams,
  userMessage,
} from '../api'
import type {
  ApiMeasurementFinding,
  MeasurementFindingCategory,
  MeasurementFindingSortKey,
  MeasurementFindingStatus,
  MeasurementUnit,
} from '../api'
import { evidenceSummary } from '../measurementEvidence'
import { measurementUnitLabel } from '../measurementUnits'
import DetectionReviewDialog from './DetectionReviewDialog'
import MeasurementScaleFields from './MeasurementScaleFields'
import MeasurementObjectiveSelect from './MeasurementObjectiveSelect'
import { objectiveLabel } from '../measurementUnits'
import RenewingThumbnail from './RenewingThumbnail'

export const SCAN_BATCH_SIZE = 10
const SCAN_POLL_MS = 2000
/** Stop tracking a scan whose progress hasn't moved for this long (queued or crashed worker). */
const SCAN_STALL_MS = 600_000
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100]

export interface MeasurementReviewApi {
  fetchFindings: typeof fetchMeasurementFindings
  fetchCategories: typeof fetchMeasurementFindingCategories
  fetchImage: typeof fetchImage
  scan: typeof scanMeasurements
  scanProgress: typeof fetchMeasurementScanProgress
  scanRemaining: typeof fetchMeasurementScanRemaining
  approve: typeof approveMeasurementFinding
  reject: typeof rejectMeasurementFinding
  reset: typeof resetMeasurementFinding
  bulkApprove: typeof bulkApproveMeasurementFindings
  preview: typeof previewMeasurementFinding
  updateParams: typeof updateMeasurementFindingParams
}

const defaultApi: MeasurementReviewApi = {
  fetchFindings: fetchMeasurementFindings,
  fetchCategories: fetchMeasurementFindingCategories,
  fetchImage,
  scan: scanMeasurements,
  scanProgress: fetchMeasurementScanProgress,
  scanRemaining: fetchMeasurementScanRemaining,
  approve: approveMeasurementFinding,
  reject: rejectMeasurementFinding,
  reset: resetMeasurementFinding,
  bulkApprove: bulkApproveMeasurementFindings,
  preview: previewMeasurementFinding,
  updateParams: updateMeasurementFindingParams,
}

export interface MeasurementReviewPageProps {
  /** Injected for stories/tests; defaults to the real API client. */
  api?: MeasurementReviewApi
  /** Open the image in the viewer (thumbnail link). */
  onOpenImage?: (imageId: number) => void
  /** Open the image's edit dialog (name link). */
  onEditImage?: (imageId: number) => void
  /** Bump to force the findings list to refetch (e.g. after an image edit). */
  refreshToken?: number
  /** Scan-progress poll interval; shortened in tests. */
  scanPollMs?: number
  /** Give up tracking after this long without progress; shortened in tests. */
  scanStallMs?: number
}

interface ScanState {
  /** Per-image tracking when set; absent for whole-library scans. */
  imageIds?: number[]
  /** Whole-library rescan progress counts stale-detector candidates. */
  rescan?: boolean
  /** Bounds whole-library progress to the submitted candidate set. */
  maxImageId?: number
  total: number
  done: number
}

type ReviewStatus = Exclude<MeasurementFindingStatus, 'superseded'>
type Correction = { scale?: number; unit?: MeasurementUnit; objective?: string | null }

function formatScale(scale: number | null): string {
  if (scale == null) return '—'
  // Sub-0.01 scales (e.g. px/nm) would round to 0.00.
  return scale < 0.01 ? String(Number(scale.toPrecision(3))) : scale.toFixed(2)
}

function formatWithUnit(scale: number | null, unit: string): string {
  return scale == null ? '—' : `${formatScale(scale)} px/${measurementUnitLabel(unit)}`
}

function parseScale(value: string): number | null {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export default function MeasurementReviewPage({
  api = defaultApi,
  onOpenImage,
  onEditImage,
  refreshToken = 0,
  scanPollMs = SCAN_POLL_MS,
  scanStallMs = SCAN_STALL_MS,
}: MeasurementReviewPageProps) {
  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [sortKey, setSortKey] = useState<MeasurementFindingSortKey>('confidence')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categories, setCategories] = useState<MeasurementFindingCategory[]>([])
  const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0])
  const [findings, setFindings] = useState<ApiMeasurementFinding[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [unitEdits, setUnitEdits] = useState<Record<number, MeasurementUnit>>({})
  const [objectiveEdits, setObjectiveEdits] = useState<Record<number, string>>({})
  const [reloadToken, setReloadToken] = useState(0)
  const [scan, setScan] = useState<ScanState | null>(null)
  const [learnMoreOpen, setLearnMoreOpen] = useState(false)
  const [tuningFinding, setTuningFinding] = useState<ApiMeasurementFinding | null>(null)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    // Selection and in-progress corrections belong to the rows on screen;
    // prune them to the fetched page rather than clearing, so an external
    // refresh (e.g. an image edited in the shared dialog) doesn't discard them.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoading(true)
    api
      .fetchFindings({
        status,
        sort: `${sortKey}_${sortDir}`,
        ...(categoryId != null ? { categoryId } : {}),
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      })
      .then((result) => {
        if (cancelled) return
        const lastPage = Math.max(0, Math.ceil(result.total / rowsPerPage) - 1)
        if (page > lastPage) {
          // Reviewing the last rows of a later page shrinks the list under it.
          setPage(lastPage)
          return
        }
        const onScreen = new Set(result.items.map((f) => f.id))
        setSelected((prev) => new Set([...prev].filter((id) => onScreen.has(id))))
        setEdits((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => onScreen.has(Number(id)))),
        )
        setUnitEdits((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => onScreen.has(Number(id)))),
        )
        setObjectiveEdits((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => onScreen.has(Number(id)))),
        )
        setFindings(result.items)
        setTotal(result.total)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(userMessage(err, 'Could not load measurement findings.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, status, sortKey, sortDir, categoryId, page, rowsPerPage, reloadToken, refreshToken])

  useEffect(() => {
    let cancelled = false
    api
      .fetchCategories(status)
      .then((result) => {
        if (!cancelled) setCategories(result)
      })
      // The filter is a convenience; the table still loads without it.
      .catch(() => {
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [api, status, reloadToken, refreshToken])

  const handleSort = (key: MeasurementFindingSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'confidence' ? 'desc' : 'asc')
    }
    setPage(0)
  }

  const sortLabel = (key: MeasurementFindingSortKey, label: ReactNode) => (
    <TableSortLabel
      active={sortKey === key}
      direction={sortKey === key ? sortDir : 'asc'}
      onClick={() => handleSort(key)}
    >
      {label}
    </TableSortLabel>
  )

  const sortDirection = (key: MeasurementFindingSortKey) => (sortKey === key ? sortDir : false)

  const runAction = (action: () => void) => {
    setActionsAnchor(null)
    action()
  }

  // Keep the chosen category selectable even after its last finding is reviewed.
  const categoryOptions =
    categoryId != null && !categories.some((c) => c.id === categoryId)
      ? [...categories, { id: categoryId, path: 'Selected category', count: 0 }]
      : categories

  const scanActive = scan != null
  const scanIds = scan?.imageIds
  const scanRescan = scan?.rescan === true
  const scanMaxImageId = scan?.maxImageId
  const scanTotal = scan?.total
  useEffect(() => {
    if (!scanActive || scanTotal == null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastDone = -1
    let lastChange = Date.now()
    const check = (): Promise<{ total: number; done: number }> =>
      scanIds
        ? api.scanProgress(scanIds)
        : api
            .scanRemaining({ rescan: scanRescan, maxImageId: scanMaxImageId })
            .then(({ remaining }) => ({
              total: scanTotal,
              done: Math.min(scanTotal, scanTotal - remaining),
            }))
    const poll = () => {
      timer = setTimeout(() => {
        check()
          .then(({ done, total }) => {
            if (cancelled) return
            if (done >= total) {
              setScan(null)
              setNotice(`Scan finished: ${total} image${total === 1 ? '' : 's'} processed.`)
              reload()
            } else if (done === lastDone && Date.now() - lastChange >= scanStallMs) {
              setScan(null)
              // The job may only be waiting behind other worker jobs, so don't call it failed.
              setNotice(
                `No scan progress for a while (${done} of ${total} done). It may still be running; use Refresh to check for new findings.`,
              )
            } else {
              if (done !== lastDone) {
                lastDone = done
                lastChange = Date.now()
              }
              setScan((current) => (current ? { ...current, done } : current))
              poll()
            }
          })
          .catch((err: unknown) => {
            if (cancelled) return
            setScan(null)
            setError(userMessage(err, 'Could not check scan progress.'))
          })
      }, scanPollMs)
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    api,
    scanActive,
    scanIds,
    scanRescan,
    scanMaxImageId,
    scanTotal,
    scanPollMs,
    scanStallMs,
    reload,
  ])

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setNotice(null)
    try {
      const message = await action()
      setError(null)
      setNotice(message)
      reload()
    } catch (err) {
      setError(userMessage(err, 'The request failed.'))
    } finally {
      setBusy(false)
    }
  }

  const handleScan = () =>
    run(async () => {
      const result = await api.scan({ limit: SCAN_BATCH_SIZE })
      if (result.image_ids.length === 0) return 'Every image has already been scanned.'
      setScan({ imageIds: result.image_ids, total: result.image_ids.length, done: 0 })
      return null
    })

  const handleScanAll = () =>
    run(async () => {
      const result = await api.scan({ all: true })
      if (result.image_ids.length === 0) return 'Every image has already been scanned.'
      setScan({
        total: result.image_ids.length,
        done: 0,
        maxImageId: Math.max(...result.image_ids),
      })
      return null
    })

  const handleRescanAll = () =>
    run(async () => {
      const result = await api.scan({ all: true, rescan: true })
      if (result.image_ids.length === 0) {
        return 'Every unscaled image already has a finding from the current detector.'
      }
      setScan({
        total: result.image_ids.length,
        done: 0,
        rescan: true,
        maxImageId: Math.max(...result.image_ids),
      })
      return null
    })

  const handleReset = (finding: ApiMeasurementFinding) =>
    run(async () => {
      await api.reset(finding.id)
      return `Reset “${finding.image_name}” to pending.`
    })

  /** `{}` to accept the proposal, `{ scale?, unit?, objective? }` for a correction, `null` if the edit is invalid. */
  const correctionFor = (finding: ApiMeasurementFinding): Correction | null => {
    const correction: Correction = {}
    const edited = edits[finding.id]
    if (edited != null) {
      const scale = parseScale(edited)
      if (scale == null) return null
      if (scale !== finding.proposed_scale) correction.scale = scale
    }
    const unit = unitEdits[finding.id]
    if (unit != null && unit !== finding.proposed_unit) correction.unit = unit
    const objective = objectiveEdits[finding.id]
    if (objective != null && objective !== (finding.objective ?? ''))
      correction.objective = objective || null
    return correction
  }

  // Known cameras have a calibrated scale per objective, so picking one fills it in.
  const handleObjectiveChange = (finding: ApiMeasurementFinding, value: string) => {
    setObjectiveEdits((prev) => ({ ...prev, [finding.id]: value }))
    const calibrated = value ? finding.objective_scales?.[value] : undefined
    if (calibrated != null) {
      setEdits((prev) => ({ ...prev, [finding.id]: String(calibrated) }))
      setUnitEdits((prev) => ({ ...prev, [finding.id]: 'um' }))
    }
  }

  const handleApprove = (finding: ApiMeasurementFinding) =>
    run(async () => {
      await api.approve(finding.id, correctionFor(finding) ?? {})
      return `Approved “${finding.image_name}”.`
    })

  const handleReject = (finding: ApiMeasurementFinding) =>
    run(async () => {
      await api.reject(finding.id)
      return `Rejected “${finding.image_name}”.`
    })

  const handleBulkApprove = () =>
    run(async () => {
      // The bulk endpoint only promotes proposals, so corrected rows go one by one.
      const plain: number[] = []
      const corrected: { id: number; correction: Correction }[] = []
      let invalid = 0
      for (const f of findings.filter((row) => selected.has(row.id))) {
        const correction = correctionFor(f)
        if (correction == null) invalid += 1
        else if (Object.keys(correction).length) corrected.push({ id: f.id, correction })
        else plain.push(f.id)
      }
      for (const { id, correction } of corrected) await api.approve(id, correction)
      const result = plain.length ? await api.bulkApprove(plain) : { approved: [], skipped: [] }
      const skippedCount = result.skipped.length + invalid
      const skipped = skippedCount ? `, skipped ${skippedCount}` : ''
      return `Approved ${result.approved.length + corrected.length}${skipped}.`
    })

  const pending = status === 'pending'
  // Findings without a proposed scale need a manual value, so bulk skips them.
  const selectable = findings.filter((f) => f.proposed_scale != null)
  const allSelected = selectable.length > 0 && selectable.every((f) => selected.has(f.id))

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.paper', minHeight: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: 1 }}>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
          Measurement review
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Give every image a scale so students can take real-world measurements in the viewer. Use{' '}
        <strong>Actions → Scan next {SCAN_BATCH_SIZE}</strong> to generate proposals, then approve,
        correct or reject each one below.{' '}
        <Link
          component="button"
          variant="body2"
          onClick={() => setLearnMoreOpen(true)}
          sx={{ verticalAlign: 'baseline' }}
        >
          Learn more
        </Link>
      </Typography>

      <Dialog
        open={learnMoreOpen}
        onClose={() => setLearnMoreOpen(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="measurement-learn-more-title"
      >
        <DialogTitle id="measurement-learn-more-title">How measurement review works</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" component="div" sx={{ '& p': { mt: 0, mb: 1.5 } }}>
            <p>
              Scanning proposes each image&apos;s scale — pixels per unit — so students can measure
              real-world distances in the viewer. The detector measures red blood cells (their known
              ~7.5 µm diameter) to estimate the scale; images that already carry a scale are
              recorded as-is, since stored values are authoritative and never overwritten.
            </p>
            <p>
              <strong>Pending</strong> — approve a proposal, correct the scale/unit first and
              approve, or reject it. Nothing reaches image metadata until a finding is approved.
              <br />
              <strong>Approved</strong> — the scale is live on the image. <strong>Reset</strong>{' '}
              sends the finding back to Pending and removes the scale that approval wrote (a scale
              changed since then stays put).
              <br />
              <strong>Rejected</strong> — out of the review queue; <strong>Reset</strong> returns it
              to Pending.
            </p>
            <p>
              <strong>Scan next {SCAN_BATCH_SIZE}</strong> processes a small batch;{' '}
              <strong>Scan all</strong> queues the whole library in the background.{' '}
              <strong>Re-scan outdated</strong> re-runs detection on unscaled images whose findings
              came from an older detector version — use it after a detector or calibration update.
            </p>
            <p>
              <strong>Confidence</strong> combines how much of the detected cell population agrees
              on one size peak with how many cells were measured (full credit near 100 cells). On
              known cameras it is scaled by how clearly the measurement points to one
              objective&apos;s calibrated value, and halved when it lands more than ~1.5× off the
              nearest objective. Unknown cameras cap at 30%; a scale already stored on the image
              records 100%.
            </p>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLearnMoreOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }} useFlexGap>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v: ReviewStatus | null) => {
            if (v) {
              setStatus(v)
              setPage(0)
            }
          }}
          aria-label="Finding status"
        >
          <ToggleButton value="pending">Pending</ToggleButton>
          <ToggleButton value="approved">Approved</ToggleButton>
          <ToggleButton value="rejected">Rejected</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select
          size="small"
          label="Category"
          value={categoryId ?? ''}
          onChange={(e) => {
            setCategoryId(e.target.value === '' ? null : Number(e.target.value))
            setPage(0)
          }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All categories</MenuItem>
          {categoryOptions.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.path} ({c.count})
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        {pending && (
          <Button
            variant="outlined"
            onClick={handleBulkApprove}
            disabled={busy || selected.size === 0}
          >
            Approve selected ({selected.size})
          </Button>
        )}
        <Button
          variant="contained"
          endIcon={<ArrowDropDownIcon />}
          onClick={(e) => setActionsAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={actionsAnchor != null}
          aria-controls={actionsAnchor ? 'measurement-actions-menu' : undefined}
          id="measurement-actions-button"
        >
          Actions
        </Button>
        <Menu
          id="measurement-actions-menu"
          anchorEl={actionsAnchor}
          open={actionsAnchor != null}
          onClose={() => setActionsAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ list: { 'aria-labelledby': 'measurement-actions-button' } }}
        >
          <MenuItem onClick={() => runAction(handleScan)} disabled={busy || scan != null}>
            <ListItemText
              primary={`Scan next ${SCAN_BATCH_SIZE}`}
              secondary="Propose scales for a small batch of unscaled images"
            />
          </MenuItem>
          <MenuItem onClick={() => runAction(handleScanAll)} disabled={busy || scan != null}>
            <ListItemText
              primary="Scan all"
              secondary="Queue every remaining image in the background"
            />
          </MenuItem>
          <MenuItem onClick={() => runAction(handleRescanAll)} disabled={busy || scan != null}>
            <ListItemText
              primary="Re-scan outdated"
              secondary="Re-run detection on findings from an older detector version"
            />
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => runAction(reload)} disabled={busy}>
            <ListItemText primary="Refresh" />
          </MenuItem>
        </Menu>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Snackbar open={scan != null} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert severity="info" variant="filled" sx={{ minWidth: 280 }} role="status">
          {scan && (
            <>
              Scanning images: {scan.done} of {scan.total} done
              <LinearProgress
                variant="determinate"
                value={(scan.done / scan.total) * 100}
                aria-label="Scan progress"
                color="inherit"
                sx={{ mt: 1 }}
              />
            </>
          )}
        </Alert>
      </Snackbar>

      <TableContainer>
        {loading && <LinearProgress aria-label="Loading findings" />}
        <Table size="small" aria-label="Measurement findings">
          <TableHead>
            <TableRow>
              {pending && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    disabled={selectable.length === 0}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(selectable.map((f) => f.id)))
                    }
                    inputProps={{ 'aria-label': 'Select all findings' }}
                  />
                </TableCell>
              )}
              <TableCell sortDirection={sortDirection('name')}>
                {sortLabel('name', 'Image')}
              </TableCell>
              <TableCell sortDirection={sortDirection('category')}>
                {sortLabel('category', 'Category')}
              </TableCell>
              <TableCell sortDirection={sortDirection('objective')}>
                <Tooltip title="Microscope objective lens (×10, ×40 or ×100) the detector matched for this camera. Its calibrated px/µm is the proposed scale; picking another objective fills in its calibrated scale. Approving saves it as the image's objective unless one is already stored. Blank for unknown cameras.">
                  <span>{sortLabel('objective', 'Detected objective')}</span>
                </Tooltip>
              </TableCell>
              <TableCell sortDirection={sortDirection('proposed')}>
                {sortLabel('proposed', 'Proposed')}
              </TableCell>
              <TableCell>
                {pending ? 'Scale (px per unit) and unit' : 'Scale (px per unit)'}
              </TableCell>
              <TableCell sortDirection={sortDirection('confidence')}>
                {sortLabel('confidence', 'Confidence')}
              </TableCell>
              <TableCell>Evidence</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && findings.length === 0 && (
              <TableRow>
                <TableCell colSpan={pending ? 9 : 8}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    {pending
                      ? `No findings to review. Use “Scan next ${SCAN_BATCH_SIZE}” or “Scan all” to assess more images.`
                      : `No ${status} findings.`}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {findings.map((f) => {
              const edit = edits[f.id]
              const invalidEdit = edit != null && parseScale(edit) == null
              const canApprove = edit != null ? !invalidEdit : f.proposed_scale != null
              return (
                <TableRow key={f.id} hover selected={selected.has(f.id)}>
                  {pending && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.has(f.id)}
                        disabled={f.proposed_scale == null}
                        onChange={() => toggle(f.id)}
                        inputProps={{ 'aria-label': `Select ${f.image_name}` }}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {pending || onOpenImage ? (
                        <Link
                          component="button"
                          onClick={() =>
                            pending ? setTuningFinding(f) : onOpenImage?.(f.image_id)
                          }
                          aria-label={
                            pending ? `Inspect and tune ${f.image_name}` : `Open ${f.image_name}`
                          }
                          sx={{ display: 'block', lineHeight: 0 }}
                        >
                          <RenewingThumbnail
                            image={{ id: f.image_id, thumb: f.image_thumb }}
                            alt=""
                            sx={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 0.5 }}
                          />
                        </Link>
                      ) : (
                        <RenewingThumbnail
                          image={{ id: f.image_id, thumb: f.image_thumb }}
                          alt=""
                          sx={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 0.5 }}
                        />
                      )}
                      <Box>
                        {onEditImage ? (
                          <Link
                            component="button"
                            variant="body2"
                            onClick={() => onEditImage(f.image_id)}
                            sx={{ textAlign: 'left' }}
                          >
                            {f.image_name}
                          </Link>
                        ) : (
                          <Typography variant="body2">{f.image_name}</Typography>
                        )}
                        {f.image_width != null && f.image_height != null && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {f.image_width}×{f.image_height}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      color={f.category_path ? 'text.primary' : 'text.secondary'}
                    >
                      {f.category_path ?? 'Uncategorized'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {pending ? (
                      <MeasurementObjectiveSelect
                        size="small"
                        ariaLabel={f.image_name}
                        value={objectiveEdits[f.id] ?? f.objective ?? ''}
                        onChange={(value) => handleObjectiveChange(f, value)}
                      />
                    ) : (
                      objectiveLabel(
                        // Approved rows show what the approval stored, not the detection.
                        f.status === 'approved' ? f.approved_objective : f.objective,
                      ) || '—'
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatWithUnit(f.proposed_scale, f.proposed_unit)}
                  </TableCell>
                  <TableCell>
                    {pending ? (
                      <Box sx={{ minWidth: 250 }}>
                        <MeasurementScaleFields
                          size="small"
                          ariaLabel={f.image_name}
                          scale={edit ?? (f.proposed_scale != null ? String(f.proposed_scale) : '')}
                          unit={unitEdits[f.id] ?? f.proposed_unit}
                          placeholder="Enter scale"
                          error={invalidEdit}
                          onScaleChange={(value) =>
                            setEdits((prev) => ({ ...prev, [f.id]: value }))
                          }
                          onUnitChange={(value) =>
                            setUnitEdits((prev) => ({ ...prev, [f.id]: value as MeasurementUnit }))
                          }
                        />
                      </Box>
                    ) : (
                      formatWithUnit(
                        f.approved_scale ?? f.proposed_scale,
                        f.approved_unit ?? f.proposed_unit,
                      )
                    )}
                  </TableCell>
                  <TableCell>{Math.round(f.confidence * 100)}%</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {evidenceSummary(f)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {pending ? (
                      <>
                        <Button
                          size="small"
                          onClick={() => handleApprove(f)}
                          disabled={busy || !canApprove}
                          aria-label={`Approve ${f.image_name}`}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleReject(f)}
                          disabled={busy}
                          aria-label={`Reject ${f.image_name}`}
                        >
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => handleReset(f)}
                        disabled={busy}
                        aria-label={`Reset ${f.image_name}`}
                      >
                        Reset
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(Number(e.target.value))
          setPage(0)
        }}
      />
      <DetectionReviewDialog
        open={tuningFinding != null}
        finding={tuningFinding}
        onClose={() => setTuningFinding(null)}
        onOpenImage={onOpenImage}
        api={{
          fetchImage: api.fetchImage,
          preview: api.preview,
          updateParams: api.updateParams,
        }}
        onApplied={(updated) => {
          setFindings((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
        }}
      />
    </Box>
  )
}
