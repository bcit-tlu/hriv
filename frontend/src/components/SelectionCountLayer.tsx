/**
 * Orchestrates all per-selection counting UI inside the OSD viewer
 * (epic #1661, #1667/#1668). Mounted via portal into `viewer.container` by
 * ImageViewer so it survives OSD full-page mode.
 *
 * - One `CountObjectsButton` per selection, positioned imperatively above
 *   its top-right corner on every viewport event (no per-frame renders).
 * - `useSelectionCounts` owns the job lifecycle; `clearedToken` bumps on
 *   clear-all -> cancelAll.
 * - `CountOutlinesLayer` draws done results; `CountProgressSnackbar` shows
 *   progress/errors; `CountReportDialog` auto-opens once per job and can
 *   be reopened via "View results"; `CountHelpDialog` opens in place.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'

import { selectionToLevel0, type CountSelectionRect } from '../countingUi'
import { useSelectionCounts } from '../useSelectionCounts'
import CountObjectsButton from './CountObjectsButton'
import CountOutlinesLayer from './CountOutlinesLayer'
import CountProgressSnackbar from './CountProgressSnackbar'
import CountReportDialog from './CountReportDialog'
import CountHelpDialog from './CountHelpDialog'

export type { CountSelectionRect }

export default function SelectionCountLayer({
  viewer,
  imageId,
  selections,
  clearedToken,
  hidden = false,
}: {
  viewer: OpenSeadragon.Viewer
  imageId: number
  selections: CountSelectionRect[]
  /** Incremented on "Clear all selection rectangles" -> cancels all jobs. */
  clearedToken: number
  /** Hide the per-selection buttons (canvas edit mode / mid-drag). */
  hidden?: boolean
}) {
  const { entries, start, cancel, cancelAll } = useSelectionCounts(imageId)
  const anchorsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const [reportKey, setReportKey] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // Menus portal here: inside viewer.container (visible in OSD full-page
  // mode) and under data-hriv-canvas-ui, so the selection tracker ignores
  // presses on them.
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null)
  const autoOpenedRef = useRef<Set<string>>(new Set())

  const keyFor = (key: number) => `sel-${key}`
  const entryFor = useCallback(
    (key: number) => entries.find((e) => e.key === keyFor(key)),
    [entries],
  )

  // Clear-all cancels every job.
  const prevToken = useRef(clearedToken)
  useEffect(() => {
    if (clearedToken !== prevToken.current) {
      prevToken.current = clearedToken
      cancelAll()
      setReportKey(null)
      autoOpenedRef.current.clear()
    }
  }, [clearedToken, cancelAll])

  // Auto-open the report when a job finishes — unless one is already open.
  // Tracked by job id (not selection key) so a recount of the same
  // selection auto-opens its new report too.
  useEffect(() => {
    if (reportKey != null) return
    const doneEntry = entries.find(
      (e) => e.phase === 'done' && e.jobId != null && !autoOpenedRef.current.has(e.jobId),
    )
    if (doneEntry) {
      autoOpenedRef.current.add(doneEntry.jobId as string)
      setReportKey(doneEntry.key)
    }
  }, [entries, reportKey])

  // Imperative button positioning on viewport events.
  useEffect(() => {
    const sels = selections
    const toElement = (x: number, y: number) =>
      viewer.viewport.viewportToViewerElementCoordinates(new OpenSeadragon.Point(x, y))
    const reposition = () => {
      for (const sel of sels) {
        const el = anchorsRef.current.get(sel.key)
        if (!el) continue
        const r = sel.rect
        const corners = [
          toElement(r.x, r.y),
          toElement(r.x + r.width, r.y),
          toElement(r.x + r.width, r.y + r.height),
          toElement(r.x, r.y + r.height),
        ]
        const top = Math.min(...corners.map((c) => c.y))
        const right = Math.max(...corners.map((c) => c.x))
        el.style.left = `${right}px`
        el.style.top = `${top - 8}px`
      }
    }
    const events = [
      'animation',
      'animation-finish',
      'resize',
      'rotate',
      'flip',
      'viewport-change',
      'open',
    ] as const
    for (const e of events) viewer.addHandler(e, reposition)
    reposition()
    return () => {
      for (const e of events) viewer.removeHandler(e, reposition)
    }
  }, [viewer, selections])

  const activeEntries = useMemo(
    () =>
      entries.filter(
        (e) => e.phase === 'starting' || e.phase === 'queued' || e.phase === 'running',
      ),
    [entries],
  )
  const failedEntry = entries.find((e) => e.phase === 'failed') ?? null

  const reportEntry = reportKey ? entries.find((e) => e.key === reportKey) : undefined

  // Polling updates `entries` every tick; only rebuild the canvas items
  // when the SET of finished jobs changes, not per tick.
  const doneSignature = entries
    .filter((e) => e.phase === 'done' && e.result)
    .map((e) => e.jobId ?? e.key)
    .join('|')
  const outlineItems = useMemo(
    () =>
      entries
        .filter((e) => e.phase === 'done' && e.result)
        .map((e) => ({
          selection: e.selection,
          objects: e.result!.objects,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doneSignature],
  )

  const handleCount = useCallback(
    (sel: CountSelectionRect, mode: 'cells' | 'nuclei') => {
      const level0 = selectionToLevel0(viewer, sel.rect)
      if (!level0) return
      void start(keyFor(sel.key), `Selection ${sel.index}`, level0, mode)
    },
    [viewer, start],
  )

  return (
    <>
      <div ref={setMenuHost} data-hriv-canvas-ui />
      <CountOutlinesLayer viewer={viewer} items={outlineItems} />
      {!hidden &&
        selections.map((sel) => {
          const k = keyFor(sel.key)
          const entry = entryFor(sel.key)
          return (
            <div
              key={sel.key}
              ref={(el) => {
                if (el) anchorsRef.current.set(sel.key, el)
                else anchorsRef.current.delete(sel.key)
              }}
              data-hriv-canvas-ui
              style={{
                position: 'absolute',
                transform: 'translate(-100%, -100%)',
                zIndex: 14,
              }}
            >
              <CountObjectsButton
                selectionIndex={sel.index}
                entry={entry}
                menuContainer={menuHost ?? viewer.container}
                onCount={(mode) => handleCount(sel, mode)}
                onCancel={() => cancel(k)}
                onViewResults={() => setReportKey(k)}
              />
            </div>
          )
        })}
      <CountProgressSnackbar
        activeEntries={activeEntries}
        errorEntry={failedEntry}
        // Cancel only the jobs still running — finished results stay.
        onCancelActive={() => activeEntries.forEach((e) => cancel(e.key))}
        onDismissError={(key) => cancel(key)}
        onRetry={(e) => void start(e.key, e.label, e.selection, e.mode)}
      />
      {reportEntry?.result ? (
        <CountReportDialog
          open
          onClose={() => setReportKey(null)}
          label={reportEntry.label}
          mode={reportEntry.mode}
          selection={reportEntry.selection}
          total={reportEntry.result.total}
          groups={reportEntry.result.groups}
          objects={reportEntry.result.objects}
          preview={reportEntry.result.preview}
          onLearnMore={() => setHelpOpen(true)}
          container={viewer.container}
        />
      ) : null}
      <CountHelpDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        container={viewer.container}
      />
    </>
  )
}
