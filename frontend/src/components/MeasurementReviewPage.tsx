import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import LinearProgress from '@mui/material/LinearProgress'
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
import Typography from '@mui/material/Typography'
import {
  approveMeasurementFinding,
  bulkApproveMeasurementFindings,
  fetchMeasurementFindings,
  rejectMeasurementFinding,
  scanMeasurements,
  userMessage,
} from '../api'
import type { ApiMeasurementFinding, MeasurementFindingStatus } from '../api'
import { evidenceSummary } from '../measurementEvidence'
import RenewingThumbnail from './RenewingThumbnail'

export const SCAN_BATCH_SIZE = 10
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100]

export interface MeasurementReviewApi {
  fetchFindings: typeof fetchMeasurementFindings
  scan: typeof scanMeasurements
  approve: typeof approveMeasurementFinding
  reject: typeof rejectMeasurementFinding
  bulkApprove: typeof bulkApproveMeasurementFindings
}

const defaultApi: MeasurementReviewApi = {
  fetchFindings: fetchMeasurementFindings,
  scan: scanMeasurements,
  approve: approveMeasurementFinding,
  reject: rejectMeasurementFinding,
  bulkApprove: bulkApproveMeasurementFindings,
}

export interface MeasurementReviewPageProps {
  /** Injected for stories/tests; defaults to the real API client. */
  api?: MeasurementReviewApi
}

type ReviewStatus = Exclude<MeasurementFindingStatus, 'superseded'>

function formatScale(scale: number | null): string {
  return scale == null ? '—' : scale.toFixed(2)
}

function parseScale(value: string): number | null {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export default function MeasurementReviewPage({ api = defaultApi }: MeasurementReviewPageProps) {
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
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    // Selection and in-progress corrections belong to the rows on screen.
    /* eslint-disable react-hooks/set-state-in-effect -- standard data-fetch reset before reload */
    setLoading(true)
    setSelected(new Set())
    setEdits({})
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
      return result.image_ids.length === 0
        ? 'Every image already has a scale or a finding.'
        : `Scanning ${result.image_ids.length} image${result.image_ids.length === 1 ? '' : 's'}. Refresh in a moment to see the findings.`
    })

  /** `{}` to accept the proposal, `{ scale }` for a correction, `null` if the edit is invalid. */
  const correctionFor = (finding: ApiMeasurementFinding): { scale?: number } | null => {
    const edited = edits[finding.id]
    if (edited == null) return {}
    const scale = parseScale(edited)
    if (scale == null) return null
    return scale !== finding.proposed_scale ? { scale } : {}
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
      const corrected: { id: number; scale: number }[] = []
      let invalid = 0
      for (const f of findings.filter((row) => selected.has(row.id))) {
        const correction = correctionFor(f)
        if (correction == null) invalid += 1
        else if (correction.scale != null) corrected.push({ id: f.id, scale: correction.scale })
        else plain.push(f.id)
      }
      for (const { id, scale } of corrected) await api.approve(id, { scale })
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
        Proposed image scales (pixels per µm) from the red-blood-cell detector. Nothing reaches
        image metadata until a finding is approved. Correct a scale before approving if the proposal
        is wrong.
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
        <Button variant="contained" onClick={handleScan} disabled={busy}>
          Scan next {SCAN_BATCH_SIZE}
        </Button>
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
              <TableCell>Objective</TableCell>
              <TableCell>Scale (px/µm)</TableCell>
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
              {pending && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && findings.length === 0 && (
              <TableRow>
                <TableCell colSpan={pending ? 7 : 5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    {pending
                      ? `No findings to review. Use “Scan next ${SCAN_BATCH_SIZE}” to assess more images.`
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
                  <TableCell>
                    {pending ? (
                      <TextField
                        size="small"
                        type="number"
                        value={edit ?? (f.proposed_scale != null ? String(f.proposed_scale) : '')}
                        placeholder="Enter scale"
                        error={invalidEdit}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        slotProps={{
                          htmlInput: {
                            min: 0,
                            step: 0.01,
                            'aria-label': `Scale for ${f.image_name}`,
                          },
                        }}
                        sx={{ width: 120 }}
                      />
                    ) : (
                      formatScale(f.approved_scale ?? f.proposed_scale)
                    )}
                  </TableCell>
                  <TableCell>{Math.round(f.confidence * 100)}%</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {evidenceSummary(f)}
                    </Typography>
                  </TableCell>
                  {pending && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
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
                    </TableCell>
                  )}
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
