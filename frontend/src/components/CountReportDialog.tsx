/**
 * Object count report dialog (epic #1661, #1667; manual adjust #1746).
 *
 * Figma-style modal: preview image with the group-coloured outlines drawn
 * over it (white halo + colour stroke, clipped to the selection), a "Group
 * n" legend, and a total row. Groups are appearance clusters, never named
 * object types. No export, no show/hide toggles.
 *
 * Manual adjustment (#1746): when the caller passes the adjust callbacks,
 * the report opens in "Adjust count" mode — the outlines are interactive
 * from the start: click an outline to remove it (dashed/dimmed, click
 * again to undo), click empty space to drop a median-sized outline on a
 * missed object, or drag to draw a circle of any size. Counts and the
 * legend update live; Reset restores the original result and Done leaves
 * a view-only report (Adjust count re-enters). Adjustments are
 * client-side only and die with the ephemeral result — nothing is sent
 * back to the server.
 *
 * ``container`` lets the caller mount the dialog inside the OSD viewer so
 * it stays visible in full-page mode.
 */

import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import TuneIcon from '@mui/icons-material/Tune'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'

import type { ApiCountObject, ApiCountSelection } from '../api'
import {
  circlePolygon,
  medianRadius,
  nearestGroup,
  polygonCentroid,
  visibleObjects,
  type CountObject,
} from '../countAdjust'
import { countGroupColor, countGroupLabel } from '../countPalette'
import { modeLabel } from '../countingUi'

/** Delete affordance for adjust mode: an X with a contrasting halo built
 * from theme palette tokens, so it follows light/dark mode (#1746). */
function useRemoveCursor(): string {
  const theme = useTheme()
  return useMemo(
    () =>
      `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" stroke="${theme.palette.background.paper}" stroke-width="5" stroke-linecap="round"/><path d="M7 7l10 10M17 7L7 17" stroke="${theme.palette.text.primary}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
      )}") 12 12, pointer`,
    [theme],
  )
}

export interface CountReportDialogProps {
  open: boolean
  onClose: () => void
  /** e.g. "Selection 2". */
  label: string
  mode: string
  selection: ApiCountSelection
  total: number
  groups: { group: number; count: number }[]
  objects: ApiCountObject[]
  preview: string | null
  onLearnMore: () => void
  /** Mount node — pass the OSD container to survive full-page mode. */
  container?: HTMLElement | (() => HTMLElement)
  /** #1746: combined indices (objects then added) marked removed. */
  removed?: readonly number[]
  /** #1746: outlines the user drew, appended after `objects`. */
  added?: CountObject[]
  /** #1746: toggle a combined index's removed state. */
  onToggleObject?: (index: number) => void
  /** #1746: append a user-drawn outline (group is assigned by caller). */
  onAddObject?: (obj: CountObject) => void
  /** #1746: restore the original result. */
  onResetAdjustments?: () => void
}

function OutlineGroup({
  obj,
  combinedIndex,
  isRemoved,
  interactive,
  onToggle,
}: {
  obj: CountObject
  /** Position in objects ++ added — the toggle callback's identity. */
  combinedIndex: number
  isRemoved: boolean
  interactive: boolean
  onToggle: (index: number) => void
}) {
  const removeCursor = useRemoveCursor()
  const pts = obj.polygon.map(([x, y]) => `${x},${y}`).join(' ')
  const groupName = countGroupLabel(obj.group)
  const label = isRemoved
    ? `${groupName} outline — removed; activate to restore`
    : `${groupName} outline — activate to remove`
  return (
    <g
      data-count-object={combinedIndex}
      data-removed={isRemoved || undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      opacity={isRemoved ? 0.3 : 1}
      style={{ cursor: interactive ? (isRemoved ? 'pointer' : removeCursor) : undefined }}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation()
              onToggle(combinedIndex)
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle(combinedIndex)
              }
            }
          : undefined
      }
    >
      <polygon
        points={pts}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.6}
        strokeWidth={4}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={pts}
        fill="none"
        stroke={countGroupColor(obj.group)}
        strokeWidth={2}
        strokeDasharray={isRemoved ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {/* Hit area: paints nothing but catches clicks across the interior,
          so a press inside an outline toggles it instead of starting a
          draw. `pointer-events: all` fires even with a transparent fill. */}
      <polygon
        points={pts}
        fill={countGroupColor(obj.group)}
        fillOpacity={interactive ? 0.08 : 0}
        stroke="none"
        pointerEvents={interactive ? 'all' : 'none'}
      />
    </g>
  )
}

function SelectionOutlines({
  selection,
  objects,
  added,
  removedSet,
  adjusting,
  draft,
  onToggle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  svgRef,
}: {
  selection: ApiCountSelection
  objects: ApiCountObject[]
  added: CountObject[]
  removedSet: ReadonlySet<number>
  adjusting: boolean
  draft: { cx: number; cy: number; r: number } | null
  onToggle: (index: number) => void
  onPointerDown?: (e: ReactPointerEvent) => void
  onPointerMove?: (e: ReactPointerEvent) => void
  onPointerUp?: (e: ReactPointerEvent) => void
  svgRef: RefObject<SVGSVGElement | null>
}) {
  const vb = `${selection.x} ${selection.y} ${selection.width} ${selection.height}`
  return (
    <Box
      component="svg"
      ref={svgRef}
      viewBox={vb}
      preserveAspectRatio="none"
      aria-hidden={!adjusting}
      role={adjusting ? 'region' : undefined}
      aria-label={
        adjusting
          ? 'Count preview: click an outline to remove it, click or drag to add one'
          : undefined
      }
      data-count-outlines
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: adjusting ? 'none' : undefined,
        cursor: adjusting ? 'crosshair' : undefined,
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <defs>
        <clipPath id="count-report-clip">
          <rect x={selection.x} y={selection.y} width={selection.width} height={selection.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#count-report-clip)">
        {objects.map((obj, i) => (
          <OutlineGroup
            key={i}
            obj={obj}
            combinedIndex={i}
            isRemoved={removedSet.has(i)}
            interactive={adjusting}
            onToggle={onToggle}
          />
        ))}
        {added.map((obj, j) => (
          <OutlineGroup
            key={`a${j}`}
            obj={obj}
            combinedIndex={objects.length + j}
            isRemoved={removedSet.has(objects.length + j)}
            interactive={adjusting}
            onToggle={onToggle}
          />
        ))}
        {draft ? (
          <circle
            cx={draft.cx}
            cy={draft.cy}
            r={Math.max(draft.r, 0.5)}
            fill="#FFFFFF"
            fillOpacity={0.12}
            stroke="#FFFFFF"
            strokeWidth={2}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
      </g>
    </Box>
  )
}

export default function CountReportDialog({
  open,
  onClose,
  label,
  mode,
  selection,
  total,
  groups,
  objects,
  preview,
  onLearnMore,
  container,
  removed,
  added,
  onToggleObject,
  onAddObject,
  onResetAdjustments,
}: CountReportDialogProps) {
  const adjustable = onToggleObject != null && onAddObject != null
  // Reports open in adjust mode so counts can be corrected immediately;
  // Done leaves a view-only report and Adjust count re-enters (#1746).
  const [adjusting, setAdjusting] = useState(adjustable)
  const [draft, setDraft] = useState<{ cx: number; cy: number; r: number } | null>(null)
  const draftRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  /** A press counts as a drag once the radius exceeds ~4 CSS px. */
  const minDrag = (): number => {
    const w = svgRef.current?.getBoundingClientRect().width ?? 0
    return w > 0 ? (4 * selection.width) / w : Infinity
  }
  const svgRef = useRef<SVGSVGElement | null>(null)
  const removedSet = new Set(removed ?? [])
  const addedList = added ?? []
  const hasAdjustments = removedSet.size > 0 || addedList.length > 0

  /** Client point -> viewBox (level-0) coordinates. */
  const toLevel0 = (e: ReactPointerEvent): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return [
      selection.x + ((e.clientX - rect.left) * selection.width) / rect.width,
      selection.y + ((e.clientY - rect.top) * selection.height) / rect.height,
    ]
  }

  const addOutline = (polygon: [number, number][]) => {
    const group = nearestGroup(polygon, visibleObjects(objects, addedList, removedSet))
    onAddObject?.({ group, centroid: polygonCentroid(polygon), polygon })
  }

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (!adjusting || e.button !== 0) return
    // Presses that land on an outline toggle it on click — never start a draw.
    if ((e.target as Element).closest?.('[data-count-object]')) return
    const pt = toLevel0(e)
    if (!pt) return
    draftRef.current = { startX: pt[0], startY: pt[1], moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // jsdom has no pointer capture — harmless to skip.
    }
  }

  const handlePointerMove = (e: ReactPointerEvent) => {
    const d = draftRef.current
    if (!d) return
    const pt = toLevel0(e)
    if (!pt) return
    const r = Math.hypot(pt[0] - d.startX, pt[1] - d.startY)
    if (r >= minDrag()) d.moved = true
    setDraft({ cx: d.startX, cy: d.startY, r })
  }

  const handlePointerUp = (e: ReactPointerEvent) => {
    const d = draftRef.current
    if (!d) return
    draftRef.current = null
    setDraft(null)
    const pt = toLevel0(e)
    if (!pt) return
    const r = Math.hypot(pt[0] - d.startX, pt[1] - d.startY)
    if (r < minDrag()) {
      // A press that never became a drag is a click: drop a median-sized
      // outline centred on the pointer — "click the missed object" (#1746).
      // A drag that returned to its start adds nothing.
      if (d.moved) return
      const fallback = Math.min(selection.width, selection.height) * 0.015
      const radius = medianRadius(visibleObjects(objects, addedList, removedSet), fallback)
      addOutline(circlePolygon(pt[0], pt[1], radius))
      return
    }
    // A drag — including one that only crossed the threshold at release.
    addOutline(circlePolygon(d.startX, d.startY, r))
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      container={container}
      aria-labelledby="count-report-title"
      slotProps={{
        paper: {
          sx: {
            width: 'min(860px, calc(100% - 32px))',
            m: 2,
            maxHeight: 'calc(100% - 32px)',
          },
        },
      }}
    >
      <DialogTitle
        id="count-report-title"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box>
          <Typography variant="h6" component="span" sx={{ display: 'block' }}>
            Object count report
          </Typography>
          <Typography variant="body2" color="text.secondary" component="span">
            {label} · {modeLabel(mode)}
          </Typography>
        </Box>
        <IconButton aria-label="Close report" onClick={onClose} sx={{ mt: -0.5, mr: -1 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
        <Paper
          variant="outlined"
          sx={{
            overflow: 'hidden',
            bgcolor: 'grey.900',
            position: 'relative',
            mx: 'auto',
            maxWidth: 690,
            aspectRatio: `${selection.width} / ${selection.height}`,
          }}
        >
          {preview ? (
            <Box
              component="img"
              src={preview}
              alt={`${label} with colour-coded object outlines`}
              sx={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'cover',
                // The image sits under the outlines layer — never hit.
                pointerEvents: 'none',
              }}
            />
          ) : null}
          <SelectionOutlines
            selection={selection}
            objects={objects}
            added={addedList}
            removedSet={removedSet}
            adjusting={adjusting}
            draft={draft}
            onToggle={(i) => onToggleObject?.(i)}
            svgRef={svgRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <Chip
            size="small"
            label={total === 1 ? '1 object found' : `${total} objects found`}
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              // Theme-aware chip surface: `common.white` + `text.primary`
              // is white-on-white in dark mode.
              bgcolor: 'background.paper',
              color: 'text.primary',
              fontWeight: 600,
              boxShadow: 3,
            }}
          />
        </Paper>

        {adjusting ? (
          <Alert severity="info" icon={false} sx={{ mt: 2 }}>
            Click an outline to remove it — click again to undo. Click a missed object or drag
            around it to add an outline.
          </Alert>
        ) : null}

        <Typography variant="subtitle2" component="div" sx={{ mt: 3, mb: 1.5 }}>
          Objects identified
        </Typography>
        {total === 0 ? (
          <Alert severity="info">No objects found in this selection.</Alert>
        ) : (
          <Paper variant="outlined">
            {groups.map((item, index) => (
              <Box key={item.group}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.35 }}>
                  <Box
                    role="img"
                    aria-label={`${countGroupLabel(item.group)} colour swatch`}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      bgcolor: countGroupColor(item.group),
                      boxShadow: (theme) =>
                        `inset 0 0 0 1px ${alpha(theme.palette.common.black, 0.12)}`,
                    }}
                  />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {countGroupLabel(item.group)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.count}
                  </Typography>
                </Stack>
                {index < groups.length - 1 && <Divider />}
              </Box>
            ))}
            <Divider />
            <Stack direction="row" sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 700 }}>
                Total objects
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
              >
                {total}
              </Typography>
            </Stack>
          </Paper>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Groups are based on appearance only — the counter does not identify what the objects are.
          Counts are computer-generated and may need review.{' '}
          <Link component="button" onClick={onLearnMore} underline="hover">
            Learn more about object counting
          </Link>
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Box>
          {adjustable && !adjusting ? (
            <Button
              startIcon={<TuneIcon />}
              onClick={() => setAdjusting(true)}
              aria-label="Adjust count"
            >
              Adjust count
            </Button>
          ) : null}
          {adjustable && adjusting ? (
            <>
              <Button
                startIcon={<RestartAltIcon />}
                onClick={onResetAdjustments}
                disabled={!hasAdjustments}
              >
                Reset
              </Button>
              <Button variant="outlined" onClick={() => setAdjusting(false)} sx={{ ml: 1 }}>
                Done
              </Button>
            </>
          ) : null}
        </Box>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
