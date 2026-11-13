import { useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  fetchImage,
  previewMeasurementFinding,
  updateMeasurementFindingParams,
  userMessage,
} from '../api'
import type { ApiMeasurementFinding, DetectionPreviewOut, DetectionTuning } from '../api'
import { measurementUnitLabel, objectiveLabel } from '../measurementUnits'

/** The tuning values the API defaults to — an untouched dialog is no tuning. */
const DEFAULT_TUNING: DetectionTuning = {
  sensitivity: 0.6,
  min_cell_size: 3.0,
  exclude_nuclei: true,
  advanced: null,
}

const PREVIEW_DEBOUNCE_MS = 250

export interface DetectionReviewApi {
  fetchImage: typeof fetchImage
  preview: typeof previewMeasurementFinding
  updateParams: typeof updateMeasurementFindingParams
}

const defaultApi: DetectionReviewApi = {
  fetchImage,
  preview: previewMeasurementFinding,
  updateParams: updateMeasurementFindingParams,
}

export interface DetectionReviewDialogProps {
  open: boolean
  /** The pending finding being inspected; the dialog renders inert when null. */
  finding: ApiMeasurementFinding | null
  onClose: () => void
  /** Called with the PATCH'd finding so the review table can swap the row. */
  onApplied: (finding: ApiMeasurementFinding) => void
  /** "Open in viewer" link for a full inspection. */
  onOpenImage?: (imageId: number) => void
  /** Injected for stories/tests; defaults to the real API client. */
  api?: DetectionReviewApi
  /** Preview debounce; shortened in tests. */
  previewDebounceMs?: number
  /** Viewer construction seam for stories (a fake DZI can't mount real OSD). */
  viewerFactory?: (element: HTMLElement, tileSources: string) => { destroy(): void }
}

function tuningPayload(saved: DetectionTuning | null, tuning: DetectionTuning): DetectionTuning {
  // `advanced` is API-only — preserve an override set off-UI rather than
  // silently clearing it on Apply.
  return { ...tuning, advanced: saved?.advanced ?? null }
}

function tuningEqual(a: DetectionTuning, b: DetectionTuning): boolean {
  return (
    a.sensitivity === b.sensitivity &&
    a.min_cell_size === b.min_cell_size &&
    a.exclude_nuclei === b.exclude_nuclei
  )
}

function formatScale(scale: number | null, unit: string): string {
  if (scale == null) return '—'
  const shown = scale < 0.01 ? String(Number(scale.toPrecision(3))) : scale.toFixed(2)
  return `${shown} px/${measurementUnitLabel(unit)}`
}

/**
 * Inspect-and-tune dialog for a pending measurement finding (#1871): a bare
 * OpenSeadragon view of the image — no annotations, toolbars or navigation —
 * beside the three instructor controls. Changes debounce a read-only preview
 * against the detector; Apply persists the params on the finding.
 */
export default function DetectionReviewDialog({
  open,
  finding,
  onClose,
  onApplied,
  onOpenImage,
  api = defaultApi,
  previewDebounceMs = PREVIEW_DEBOUNCE_MS,
  viewerFactory,
}: DetectionReviewDialogProps) {
  return (
    <Dialog
      open={open && finding != null}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      aria-labelledby="detection-review-title"
    >
      {/* MUI Dialog unmounts children on close; keying on the finding id
          remounts a fresh body per finding so state seeds from its params. */}
      {finding != null && (
        <DialogBody
          key={finding.id}
          finding={finding}
          onClose={onClose}
          onApplied={onApplied}
          onOpenImage={onOpenImage}
          api={api}
          previewDebounceMs={previewDebounceMs}
          viewerFactory={viewerFactory}
        />
      )}
    </Dialog>
  )
}

interface DialogBodyProps extends Omit<DetectionReviewDialogProps, 'open' | 'finding'> {
  finding: ApiMeasurementFinding
}

function DialogBody({
  finding,
  onClose,
  onApplied,
  onOpenImage,
  api = defaultApi,
  previewDebounceMs = PREVIEW_DEBOUNCE_MS,
  viewerFactory,
}: DialogBodyProps) {
  const osdRef = useRef<HTMLDivElement | null>(null)
  const previewSeq = useRef(0)

  const [tileSources, setTileSources] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [tuning, setTuning] = useState<DetectionTuning>(() => ({
    sensitivity: finding.params?.sensitivity ?? DEFAULT_TUNING.sensitivity,
    min_cell_size: finding.params?.min_cell_size ?? DEFAULT_TUNING.min_cell_size,
    exclude_nuclei: finding.params?.exclude_nuclei ?? DEFAULT_TUNING.exclude_nuclei,
    advanced: finding.params?.advanced ?? null,
  }))
  const [preview, setPreview] = useState<DetectionPreviewOut | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const saved = finding.params
  const dirty = useMemo(() => !tuningEqual(tuning, saved ?? DEFAULT_TUNING), [tuning, saved])

  // Resolve the tile URL once mounted.
  useEffect(() => {
    let cancelled = false
    api
      .fetchImage(finding.image_id)
      .then((image) => {
        if (!cancelled) setTileSources(image.tile_sources)
      })
      .catch((err: unknown) => {
        if (!cancelled) setImageError(userMessage(err, 'Could not load the image.'))
      })
    return () => {
      cancelled = true
    }
  }, [api, finding.image_id])

  // Mount the bare OSD viewer once the tile source resolves; destroy on close.
  useEffect(() => {
    if (tileSources == null || osdRef.current == null) return
    const factory =
      viewerFactory ??
      ((element: HTMLElement, src: string) =>
        OpenSeadragon({
          element,
          tileSources: src as unknown as OpenSeadragon.TileSourceSpecifier,
          showNavigationControl: false,
          showNavigator: false,
          showSequenceControl: false,
          animationTime: 0.3,
          minZoomImageRatio: 0.8,
          maxZoomPixelRatio: 4,
          visibilityRatio: 1,
          constrainDuringPan: true,
          gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false },
        }))
    const viewer = factory(osdRef.current, tileSources)
    return () => viewer.destroy()
  }, [tileSources, viewerFactory])

  // Debounced read-only preview under the candidate tuning.
  useEffect(() => {
    const seq = ++previewSeq.current
    const timer = setTimeout(() => {
      setPreviewing(true)
      api
        .preview(finding.id, tuningPayload(finding.params, tuning))
        .then((result) => {
          if (previewSeq.current !== seq) return
          setPreview(result)
          setPreviewError(null)
        })
        .catch((err: unknown) => {
          if (previewSeq.current !== seq) return
          setPreviewError(userMessage(err, 'Could not preview detection.'))
        })
        .finally(() => {
          if (previewSeq.current === seq) setPreviewing(false)
        })
    }, previewDebounceMs)
    return () => {
      clearTimeout(timer)
    }
  }, [api, finding.id, finding.params, tuning, previewDebounceMs])

  const handleApply = () => {
    setSaving(true)
    api
      .updateParams(finding.id, tuningPayload(finding.params, tuning))
      .then((updated) => {
        onApplied(updated)
        onClose()
      })
      .catch((err: unknown) => {
        setPreviewError(userMessage(err, 'Could not save the tuning.'))
      })
      .finally(() => setSaving(false))
  }

  const handleOpenInViewer = () => {
    onOpenImage?.(finding.image_id)
    onClose()
  }

  return (
    <>
      <DialogTitle id="detection-review-title">Inspect and tune — {finding.image_name}</DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ minHeight: 0 }}>
          <Box
            sx={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              height: { xs: '40vh', md: '56vh' },
              bgcolor: 'grey.900',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            {imageError ? (
              <Alert severity="warning" sx={{ m: 2 }}>
                {imageError}
              </Alert>
            ) : tileSources == null ? (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{ height: '100%' }}
                aria-label="Loading image"
              >
                <CircularProgress />
              </Stack>
            ) : null}
            {/* The ref'd div hosts OSD; it must exist before tileSources resolves. */}
            <Box ref={osdRef} data-testid="detection-osd" sx={{ position: 'absolute', inset: 0 }} />
          </Box>

          <Stack spacing={2} sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Detection sensitivity
              </Typography>
              <Slider
                aria-label="Detection sensitivity"
                min={0}
                max={1}
                step={0.05}
                value={tuning.sensitivity}
                onChange={(_, v) => setTuning((t) => ({ ...t, sensitivity: v as number }))}
              />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">
                  Only obvious cells
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Fainter cells too
                </Typography>
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Minimum cell size
              </Typography>
              <Slider
                aria-label="Minimum cell size"
                min={1}
                max={10}
                step={0.5}
                value={tuning.min_cell_size}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v} px`}
                onChange={(_, v) => setTuning((t) => ({ ...t, min_cell_size: v as number }))}
              />
              <Typography variant="caption" color="text.secondary">
                Ignore objects smaller than this radius (px)
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={tuning.exclude_nuclei}
                  onChange={(e) => setTuning((t) => ({ ...t, exclude_nuclei: e.target.checked }))}
                />
              }
              label="Exclude purple-stained nuclei"
            />
            <Button
              size="small"
              onClick={() => setTuning((t) => ({ ...DEFAULT_TUNING, advanced: t.advanced }))}
              disabled={tuningEqual(tuning, DEFAULT_TUNING)}
              sx={{ alignSelf: 'flex-start' }}
            >
              Reset to defaults
            </Button>

            <Divider />

            <Box sx={{ minHeight: 96 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2">Preview</Typography>
                {dirty && <Chip size="small" variant="outlined" color="primary" label="Unsaved" />}
              </Stack>
              {previewing && <LinearProgress sx={{ mb: 1 }} aria-label="Previewing" />}
              {previewError ? (
                <Alert severity="warning">{previewError}</Alert>
              ) : preview == null ? (
                <Typography variant="body2" color="text.secondary">
                  Adjust the controls to preview detection.
                </Typography>
              ) : preview.proposed_scale == null ? (
                <Typography variant="body2" color="text.secondary">
                  No scale could be proposed
                  {preview.reason ? ` — ${preview.reason.replace(/_/g, ' ')}` : ''}.
                </Typography>
              ) : (
                <Typography variant="body2" component="div">
                  Proposed: {formatScale(preview.proposed_scale, preview.proposed_unit)}
                  <br />
                  Objective: {objectiveLabel(preview.objective) || '—'}
                  <br />
                  Confidence: {Math.round(preview.confidence * 100)}%
                  <br />
                  {preview.diameter_px != null && (
                    <>
                      RBC ⌀ {preview.diameter_px.toFixed(1)} px
                      {preview.selected_count != null && ` · ${preview.selected_count} cells`}
                    </>
                  )}
                </Typography>
              )}
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Box>
          {onOpenImage && (
            <Link component="button" variant="body2" onClick={handleOpenInViewer}>
              Open in viewer
            </Link>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleApply}
            disabled={!dirty || saving}
            aria-label="Apply tuning"
          >
            Apply
          </Button>
        </Stack>
      </DialogActions>
    </>
  )
}
