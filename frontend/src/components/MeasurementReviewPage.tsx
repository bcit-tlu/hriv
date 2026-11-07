import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import LinearProgress from '@mui/material/LinearProgress'
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
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {
  approveMeasurementFinding,
  bulkApproveMeasurementFindings,
  fetchMeasurementFindings,
  fetchMeasurementScanProgress,
  fetchMeasurementScanRemaining,
  rejectMeasurementFinding,
  rescanMeasurementFinding,
  resetMeasurementFinding,
  scanMeasurements,
  userMessage,
} from '../api'
import type { ApiMeasurementFinding, MeasurementFindingStatus, MeasurementUnit } from '../api'
import { evidenceSummary } from '../measurementEvidence'
import { measurementUnitLabel } from '../measurementUnits'
import MeasurementScaleFields from './MeasurementScaleFields'
import RenewingThumbnail from './RenewingThumbnail'

export const SCAN_BATCH_SIZE = 10
const SCAN_POLL_MS = 2000
/** Stop tracking a scan whose progress hasn't moved for this long (queued or crashed worker). */
const SCAN_STALL_MS = 600_000
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100]

export interface MeasurementReviewApi {
  fetchFindings: typeof fetchMeasurementFindings
  scan: typeof scanMeasurements
  scanProgress: typeof fetchMeasurementScanProgress
  scanRemaining: typeof fetchMeasurementScanRemaining
  approve: typeof approveMeasurementFinding
  reject: typeof rejectMeasurementFinding
  reset: typeof resetMeasurementFinding
  rescan: typeof rescanMeasurementFinding
  bulkApprove: typeof bulkApproveMeasurementFindings
}

const defaultApi: MeasurementReviewApi = {
  fetchFindings: fetchMeasurementFindings,
  scan: scanMeasurements,
  scanProgress: fetchMeasurementScanProgress,
  scanRemaining: fetchMeasurementScanRemaining,
  approve: approveMeasurementFinding,
  reject: rejectMeasurementFinding,
  reset: resetMeasurementFinding,
  rescan: rescanMeasurementFinding,
  bulkApprove: bulkApproveMeasurementFindings,
}

export interface MeasurementReviewPageProps {
  /** Injected for stories/tests; defaults to the real API client. */
  api?: MeasurementReviewApi
  /** Scan-progress poll interval; shortened in tests. */
  scanPollMs?: number
  /** Give up tracking after this long without progress; shortened in tests. */
  scanStallMs?: number
}

interface ScanState {
  /** Per-image tracking when set; absent for whole-library scans. */
  imageIds?: number[]
  /** A rescan is done once a finding newer than this row exists. */
  minFindingId?: number
  /** Whole-library rescan progress counts stale-detector candidates. */
  rescan?: boolean
  total: number
  done: number
}

type ReviewStatus = Exclude<MeasurementFindingStatus, 'superseded'>
type Correction = { scale?: number; unit?: MeasurementUnit }

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
  scanPollMs = SCAN_POLL_MS,
  scanStallMs = SCAN_STALL_MS,
}: MeasurementReviewPageProps) {
  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [ascending, setAscending] = useState(false)
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
  const [reloadToken, setReloadToken] = useState(0)
  const [scan, setScan] = useState<ScanState | null>(null)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    // Selection and in-progress corrections belong to the rows on screen.
    /* eslint-disable react-hooks/set-state-in-effect -- standard data-fetch reset before reload */
    setLoading(true)
    setSelected(new Set())
    setEdits({})
    setUnitEdits({})
    /* eslint-enable react-hooks/set-state-in-effect */
    api
      .fetchFindings({
        status,
        sort: ascending ? 'confidence_asc' : 'confidence_desc',
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
  }, [api, status, ascending, page, rowsPerPage, reloadToken])

  const scanActive = scan != null
  const scanIds = scan?.imageIds
  const scanMinFindingId = scan?.minFindingId
  const scanRescan = scan?.rescan === true
  const scanTotal = scan?.total
  useEffect(() => {
    if (!scanActive || scanTotal == null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastDone = -1
    let lastChange = Date.now()
    const check = (): Promise<{ total: number; done: number }> =>
      scanIds
        ? api.scanProgress(scanIds, scanMinFindingId)
        : api
            .scanRemaining({ rescan: scanRescan })
            .then(({ remaining }) => ({ total: scanTotal, done: scanTotal - remaining }))
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
    scanMinFindingId,
    scanRescan,
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
      setScan({ total: result.image_ids.length, done: 0 })
      return null
    })

  const handleRescanAll = () =>
    run(async () => {
      const result = await api.scan({ all: true, rescan: true })
      if (result.image_ids.length === 0) {
        return 'Every unscaled image already has a finding from the current detector.'
      }
      setScan({ total: result.image_ids.length, done: 0, rescan: true })
      return null
    })

  const handleReset = (finding: ApiMeasurementFinding) =>
    run(async () => {
      await api.reset(finding.id)
      return `Moved “${finding.image_name}” back to pending.`
    })

  const handleRescan = (finding: ApiMeasurementFinding) =>
    run(async () => {
      const result = await api.rescan(finding.id)
      setScan({
        imageIds: result.image_ids,
        minFindingId: finding.id,
        total: result.image_ids.length,
        done: 0,
      })
      return `Re-scan queued for “${finding.image_name}”; the new proposal lands in Pending.`
    })

  /** `{}` to accept the proposal, `{ scale?, unit? }` for a correction, `null` if the edit is invalid. */
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
    return correction
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
      <Typography variant="h5" component="h1" gutterBottom>
        Measurement review
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Sets each image&apos;s scale so students can take real-world measurements in the viewer.
        Scan images (a batch or the whole library), then approve, correct or reject each proposed
        scale. Approvals and rejections can be moved back to pending, and any image can be
        re-scanned after the detector changes.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Proposed image scales (pixels per unit, µm by default) from the red-blood-cell detector.
        Nothing reaches image metadata until a finding is approved. Correct a scale before approving
        if the proposal is wrong. Scales already stored on an image are listed under Approved as
        existing values or embedded calibration and are never overwritten.
      </Typography>

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
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" onClick={reload} disabled={busy}>
          Refresh
        </Button>
        {pending && (
          <Button
            variant="outlined"
            onClick={handleBulkApprove}
            disabled={busy || selected.size === 0}
          >
            Approve selected ({selected.size})
          </Button>
        )}
        <Button variant="contained" onClick={handleScan} disabled={busy || scan != null}>
          Scan next {SCAN_BATCH_SIZE}
        </Button>
        <Button variant="outlined" onClick={handleScanAll} disabled={busy || scan != null}>
          Scan all
        </Button>
        <Tooltip title="Re-run detection on unscaled images whose findings were made by an older detector version.">
          <span>
            <Button variant="outlined" onClick={handleRescanAll} disabled={busy || scan != null}>
              Re-scan outdated
            </Button>
          </span>
        </Tooltip>
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
              <TableCell>Image</TableCell>
              <TableCell>
                <Tooltip title="Microscope objective lens (×10, ×40 or ×100) the detector matched for this camera. Its calibrated px/µm is the proposed scale. Blank for unknown cameras.">
                  <span>Detected objective</span>
                </Tooltip>
              </TableCell>
              <TableCell>Proposed</TableCell>
              <TableCell>
                {pending ? 'Scale (px per unit) and unit' : 'Scale (px per unit)'}
              </TableCell>
              <TableCell sortDirection={ascending ? 'asc' : 'desc'}>
                <TableSortLabel
                  active
                  direction={ascending ? 'asc' : 'desc'}
                  onClick={() => {
                    setAscending((a) => !a)
                    setPage(0)
                  }}
                >
                  Confidence
                </TableSortLabel>
              </TableCell>
              <TableCell>Evidence</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && findings.length === 0 && (
              <TableRow>
                <TableCell colSpan={pending ? 8 : 7}>
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
                      <RenewingThumbnail
                        image={{ id: f.image_id, thumb: f.image_thumb }}
                        alt=""
                        sx={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 0.5 }}
                      />
                      <Box>
                        <Typography variant="body2">{f.image_name}</Typography>
                        {f.image_width != null && f.image_height != null && (
                          <Typography variant="caption" color="text.secondary">
                            {f.image_width}×{f.image_height}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>{f.objective ? `×${f.objective}` : '—'}</TableCell>
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
                        aria-label={`Move ${f.image_name} to pending`}
                      >
                        Move to pending
                      </Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => handleRescan(f)}
                      disabled={busy || scan != null}
                      aria-label={`Re-scan ${f.image_name}`}
                    >
                      Re-scan
                    </Button>
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
    </Box>
  )
}
