import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import ScreenRotationIcon from '@mui/icons-material/ScreenRotation'

import { userMessage, type ApiImage } from '../api'
import type { Collection, ImageItem } from '../types'
import ImageViewer from './ImageViewer'
import RenewingThumbnail from './RenewingThumbnail'
import type { CanvasAnnotation } from './CanvasOverlay'
import {
  canvasAnnotationsFromMetadata,
  lockedOverlaysFromMetadata,
  measurementFromMetadata,
  viewportStateFromSaved,
  type MeasurementConfig,
  type OverlayRect,
  type ViewportState,
} from './imageViewerUtils'

export interface SynchronizedCollectionViewerProps {
  collection: Collection
  /** Persist `{ "<image_id>": ViewportState }` for the pair via `PUT …/viewport`. */
  onSaveViewport: (viewportState: Record<string, unknown>) => Promise<unknown>
  /** "Open image" → the regular `?image={id}` view where annotations can be edited. */
  onOpenImage: (image: ImageItem) => void
  /** Refresh a member's tokenized URLs after the viewer's tile-token renewal. */
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

type Slot = 'a' | 'b'

/**
 * B's viewport relative to A's: when the saved positions sit around different
 * highlights the pair keeps that displacement while pan/zoom/rotate mirror.
 */
interface ViewportOffset {
  dx: number
  dy: number
  zoomRatio: number
  dRotation: number
}

interface PaneProps {
  initialViewport: ViewportState | undefined
  initialOverlays: OverlayRect[] | undefined
  canvasAnnotations: CanvasAnnotation[]
  measurement: MeasurementConfig | undefined
}

function readViewport(viewer: OpenSeadragon.Viewer | null): ViewportState | null {
  const viewport = viewer?.viewport
  if (!viewport) return null
  const center = viewport.getCenter()
  return {
    zoom: viewport.getZoom(),
    x: center.x,
    y: center.y,
    rotation: viewport.getRotation(),
  }
}

function offsetBetween(b: ViewportState, a: ViewportState): ViewportOffset {
  return {
    dx: b.x - a.x,
    dy: b.y - a.y,
    zoomRatio: a.zoom > 0 ? b.zoom / a.zoom : 1,
    dRotation: (b.rotation ?? 0) - (a.rotation ?? 0),
  }
}

/** Apply `state` immediately (no animation) — used for follow + reset writes. */
function applyTarget(viewer: OpenSeadragon.Viewer, state: ViewportState): void {
  const viewport = viewer.viewport
  if (!viewport) return
  viewport.zoomTo(state.zoom, undefined, true)
  viewport.panTo(new OpenSeadragon.Point(state.x, state.y), true)
  viewport.setRotation(state.rotation ?? 0, true)
}

/** Portrait detector — jsdom has no matchMedia, so the query is optional. */
function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(
    () => window.matchMedia?.('(orientation: portrait)')?.matches ?? false,
  )
  useEffect(() => {
    const mql = window.matchMedia?.('(orientation: portrait)')
    if (!mql) return
    const onChange = (event: MediaQueryListEvent) => setPortrait(event.matches)
    setPortrait(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return portrait
}

export default function SynchronizedCollectionViewer({
  collection,
  onSaveViewport,
  onOpenImage,
  onImageRenewed,
  onError,
}: SynchronizedCollectionViewerProps) {
  const images = collection.images
  const canEdit = collection.permissions.canEdit
  const isPortrait = usePortrait()
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(() => new Set())
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  // OSD handles arrive through onViewerReady. They are registered by image
  // id — not by pane — so when a member fails and the pair slides forward,
  // the surviving viewer keeps its registration (and its pan/zoom) in the
  // new slot instead of dropping out of the sync bridge.
  const viewersByImage = useRef(new Map<number, OpenSeadragon.Viewer>())
  const openedRef = useRef(new Set<number>())
  const offsetRef = useRef<ViewportOffset | null>(null)
  const syncingRef = useRef(false)
  const syncEnabledRef = useRef(true)
  // Bumped on every registration change to re-run the attach effect.
  const [readyTick, setReadyTick] = useState(0)

  // Failures, link state, viewer registrations and the captured offset belong
  // to this collection — a different collection opened without an unmount
  // must not inherit them.
  const collectionId = collection.id
  const previousCollectionId = useRef(collectionId)
  useEffect(() => {
    if (previousCollectionId.current === collectionId) return
    previousCollectionId.current = collectionId
    setFailedIds(new Set())
    setSyncEnabled(true)
    syncEnabledRef.current = true
    offsetRef.current = null
    viewersByImage.current.clear()
    openedRef.current.clear()
  }, [collectionId])

  useEffect(() => {
    syncEnabledRef.current = syncEnabled
  }, [syncEnabled])

  const available = useMemo(
    () => images.filter((img) => !failedIds.has(img.id)),
    [images, failedIds],
  )
  const slotA = available[0]
  const slotB = available[1]
  const slotAId = slotA?.id
  const slotBId = slotB?.id

  // `initialViewport` is mount-only input for ImageViewer — freeze the saved
  // entry the first time an image occupies a pane so a later save/refetch
  // (which replaces `collection`) cannot remount the viewer and discard
  // unsaved navigation. Reset view reads `collection.viewportState` live.
  const initialViewports = useRef({
    collectionId,
    map: new Map<number, ViewportState | undefined>(),
  })
  if (initialViewports.current.collectionId !== collectionId) {
    initialViewports.current = { collectionId, map: new Map() }
  }
  const initialViewportFor = (image: ImageItem): ViewportState | undefined => {
    const { map } = initialViewports.current
    if (!map.has(image.id)) {
      map.set(image.id, viewportStateFromSaved(collection.viewportState[String(image.id)]))
    }
    return map.get(image.id)
  }

  // Per-image pane props cached by image id with each prop invalidated by its
  // own serialized metadata: a fresh `initialOverlays`/`initialViewport`
  // identity re-runs ImageViewer's mount effect and destroys the OSD viewer,
  // so an annotation or measurement edit must not mint new mount-only props.
  const panePropsCache = useRef({
    collectionId,
    map: new Map<
      number,
      { value: PaneProps; overlaysKey: string; annotationsKey: string; measurementKey: string }
    >(),
  })
  if (panePropsCache.current.collectionId !== collectionId) {
    panePropsCache.current = { collectionId, map: new Map() }
  }
  const panePropsFor = (image: ImageItem): PaneProps => {
    const overlaysKey = JSON.stringify(image.metadataExtra?.locked_overlays ?? null)
    const annotationsKey = JSON.stringify(image.metadataExtra?.canvas_annotations ?? null)
    const measurementKey = JSON.stringify([
      image.metadataExtra?.measurement_scale ?? null,
      image.metadataExtra?.measurement_unit ?? null,
    ])
    const cached = panePropsCache.current.map.get(image.id)
    const value =
      cached?.value ??
      ({
        initialViewport: initialViewportFor(image),
        initialOverlays: undefined,
        canvasAnnotations: [],
        measurement: undefined,
      } satisfies PaneProps)
    if (!cached || cached.overlaysKey !== overlaysKey) {
      value.initialOverlays = lockedOverlaysFromMetadata(image.metadataExtra)
    }
    if (!cached || cached.annotationsKey !== annotationsKey) {
      value.canvasAnnotations = canvasAnnotationsFromMetadata(image.metadataExtra)
    }
    if (!cached || cached.measurementKey !== measurementKey) {
      value.measurement = measurementFromMetadata(image.metadataExtra)
    }
    panePropsCache.current.map.set(image.id, {
      value,
      overlaysKey,
      annotationsKey,
      measurementKey,
    })
    return value
  }

  // The offset pair and cached props of images that left the pair are
  // meaningless — drop both when the occupants change. (The surviving member
  // keeps its entry, so its viewer is not remounted by a new prop identity.)
  useEffect(() => {
    offsetRef.current = null
    for (const { map } of [initialViewports.current, panePropsCache.current]) {
      for (const id of [...map.keys()]) {
        if (id !== slotAId && id !== slotBId) map.delete(id)
      }
    }
  }, [slotAId, slotBId])

  const handleViewerReady = useCallback((imageId: number, viewer: OpenSeadragon.Viewer | null) => {
    if (viewer) {
      viewersByImage.current.set(imageId, viewer)
    } else {
      viewersByImage.current.delete(imageId)
      openedRef.current.delete(imageId)
    }
    setReadyTick((tick) => tick + 1)
  }, [])

  /** Capture the current relative alignment as the offset the leader keeps. */
  const armOffset = useCallback((imgA: ImageItem, imgB: ImageItem) => {
    const a = readViewport(viewersByImage.current.get(imgA.id) ?? null)
    const b = readViewport(viewersByImage.current.get(imgB.id) ?? null)
    offsetRef.current = a && b ? offsetBetween(b, a) : null
  }, [])

  useEffect(() => {
    const detach: (() => void)[] = []
    const panes: [Slot, ImageItem][] = [
      ...(slotA ? ([['a', slotA]] as [Slot, ImageItem][]) : []),
      ...(slotB ? ([['b', slotB]] as [Slot, ImageItem][]) : []),
    ]
    for (const [slot, image] of panes) {
      const viewer = viewersByImage.current.get(image.id)
      if (!viewer) {
        openedRef.current.delete(image.id)
        continue
      }
      const otherImage = slot === 'a' ? slotB : slotA
      // 'open' is a once-handler: it runs after ImageViewer's own open handler
      // (registered at viewer creation, before onViewerReady), so the saved
      // viewport restore has already settled when the offset is captured.
      const markOpened = () => {
        openedRef.current.add(image.id)
        if (
          otherImage &&
          openedRef.current.has(otherImage.id) &&
          syncEnabledRef.current &&
          slotA &&
          slotB
        ) {
          armOffset(slotA, slotB)
        }
      }
      const onViewportChange = () => {
        if (!syncEnabledRef.current || syncingRef.current) return
        if (!otherImage || !openedRef.current.has(image.id)) return
        if (!openedRef.current.has(otherImage.id)) return
        const leader = readViewport(viewer)
        const follower = viewersByImage.current.get(otherImage.id)
        const followerPos = readViewport(follower ?? null)
        if (!leader || !follower || !followerPos) return
        if (offsetRef.current == null) {
          // First armed event just locks the offset — applying here would be
          // a no-op write, so capture and wait for the next change.
          offsetRef.current =
            slot === 'a' ? offsetBetween(followerPos, leader) : offsetBetween(leader, followerPos)
          return
        }
        const o = offsetRef.current
        const target: ViewportState =
          slot === 'a'
            ? {
                zoom: leader.zoom * o.zoomRatio,
                x: leader.x + o.dx,
                y: leader.y + o.dy,
                rotation: (leader.rotation ?? 0) + o.dRotation,
              }
            : {
                zoom: o.zoomRatio > 0 ? leader.zoom / o.zoomRatio : leader.zoom,
                x: leader.x - o.dx,
                y: leader.y - o.dy,
                rotation: (leader.rotation ?? 0) - o.dRotation,
              }
        syncingRef.current = true
        try {
          applyTarget(follower, target)
        } finally {
          syncingRef.current = false
        }
      }
      viewer.addOnceHandler('open', markOpened)
      viewer.addHandler('viewport-change', onViewportChange)
      if (viewer.viewport) markOpened()
      detach.push(() => {
        viewer.removeHandler('viewport-change', onViewportChange)
        viewer.removeHandler('open', markOpened)
      })
    }
    return () => {
      for (const d of detach) d()
    }
  }, [slotA, slotB, readyTick, armOffset])

  const handleSyncToggle = useCallback(
    (on: boolean) => {
      setSyncEnabled(on)
      syncEnabledRef.current = on
      // Re-arming preserves whatever relative alignment was set while unlinked.
      if (on && slotA && slotB) armOffset(slotA, slotB)
    },
    [armOffset, slotA, slotB],
  )

  const handleViewerError = useCallback(
    (image: ImageItem, message: string) => {
      onError(message)
      setFailedIds((prev) => (prev.has(image.id) ? prev : new Set(prev).add(image.id)))
    },
    [onError],
  )

  const handleSave = useCallback(async () => {
    if (!slotA || !slotB) return
    const a = readViewport(viewersByImage.current.get(slotA.id) ?? null)
    const b = readViewport(viewersByImage.current.get(slotB.id) ?? null)
    if (!a || !b) return
    setSaving(true)
    try {
      await onSaveViewport({
        [String(slotA.id)]: { zoom: a.zoom, x: a.x, y: a.y, rotation: a.rotation ?? 0 },
        [String(slotB.id)]: { zoom: b.zoom, x: b.x, y: b.y, rotation: b.rotation ?? 0 },
      })
    } catch (err) {
      onError(userMessage(err, 'Failed to save the collection view.'))
    } finally {
      setSaving(false)
    }
  }, [slotA, slotB, onSaveViewport, onError])

  const handleReset = useCallback(() => {
    if (!slotA || !slotB) return
    const apply = (image: ImageItem) => {
      const viewer = viewersByImage.current.get(image.id)
      const viewport = viewer?.viewport
      if (!viewer || !viewport) return
      const saved = viewportStateFromSaved(collection.viewportState[String(image.id)])
      if (saved) {
        applyTarget(viewer, saved)
      } else {
        // goHome preserves rotation — clear it separately like ImageViewer's
        // own Home action does.
        viewport.goHome(true)
        viewport.setRotation(0, true)
      }
    }
    syncingRef.current = true
    try {
      apply(slotA)
      apply(slotB)
    } finally {
      syncingRef.current = false
    }
    armOffset(slotA, slotB)
  }, [slotA, slotB, collection.viewportState, armOffset])

  if (available.length < 2) {
    return (
      <Box data-testid="synchronized-viewer-fallback">
        <Alert severity="info" sx={{ mt: 3 }}>
          {images.length < 2
            ? 'A synchronized comparison needs at least two visible images. Open an image below to view it on its own.'
            : 'Fewer than two of the images in this collection could be loaded. They may have been removed or you may no longer have access to them.'}
        </Alert>
        {images.length > 0 && (
          <List dense sx={{ mt: 2 }}>
            {images.map((img, index) => (
              <ListItem
                key={img.id}
                divider
                secondaryAction={
                  <Button
                    size="small"
                    endIcon={<OpenInNewIcon />}
                    href={`?image=${img.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenImage(img)
                    }}
                  >
                    Open image
                  </Button>
                }
              >
                <ListItemAvatar>
                  <RenewingThumbnail
                    image={img}
                    alt=""
                    sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }}
                  />
                </ListItemAvatar>
                <ListItemText primary={`${index + 1}. ${img.name}`} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    )
  }

  const panes: { image: ImageItem; pane: PaneProps }[] = [
    { image: slotA, pane: panePropsFor(slotA) },
    { image: slotB, pane: panePropsFor(slotB) },
  ]

  return (
    <Box data-testid="synchronized-collection-viewer">
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          mt: 2,
          mb: 1,
        }}
      >
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={syncEnabled}
              onChange={(_e, on) => handleSyncToggle(on)}
              data-testid="synchronized-sync-toggle"
            />
          }
          label="Link views"
        />
        {images.length > 2 && (
          <Typography variant="body2" color="text.secondary">
            Showing 2 of {images.length}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<RestartAltIcon />}
          onClick={handleReset}
          data-testid="synchronized-reset"
        >
          Reset view
        </Button>
        {canEdit && (
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="synchronized-save"
          >
            Save view
          </Button>
        )}
      </Box>

      <Box sx={{ position: 'relative' }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {panes.map(({ image, pane }) => (
            <Box key={image.id} sx={{ flex: 1, minWidth: 0 }}>
              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer
                  tileSources={image.tileSources}
                  imageId={image.id}
                  categoryId={image.categoryId ?? undefined}
                  height="55vh"
                  initialViewport={pane.initialViewport}
                  initialOverlays={pane.initialOverlays}
                  overlaysLocked={pane.initialOverlays != null}
                  canvasAnnotations={pane.canvasAnnotations}
                  canEditContent={false}
                  measurement={pane.measurement}
                  onViewerReady={(viewer) => handleViewerReady(image.id, viewer)}
                  onTileSourceRenewed={onImageRenewed}
                  onError={(message) => handleViewerError(image, message)}
                />
              </Paper>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {image.name}
                  {!image.active ? ' (inactive)' : ''}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  endIcon={<OpenInNewIcon />}
                  onClick={() => onOpenImage(image)}
                  aria-label={`Open ${image.name}`}
                >
                  Open image
                </Button>
              </Box>
            </Box>
          ))}
        </Box>

        {isPortrait && (
          <Box
            data-testid="synchronized-portrait-hint"
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'background.paper',
              borderRadius: 2,
            }}
          >
            <Alert severity="info" icon={<ScreenRotationIcon />}>
              Rotate your device to landscape to use the synchronized view.
            </Alert>
          </Box>
        )}
      </Box>
    </Box>
  )
}
