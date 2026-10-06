import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
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

/**
 * Synchronized collections store at most SYNCHRONIZED_COLLECTION_MAX_IMAGES
 * members (4) — the viewer renders up to that many panes: a side-by-side row
 * for two, a 2×2 grid for three or four (#1561).
 */
const MAX_PANES = 4

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
  // Per-pane pinning (#1564): every pane starts pinned — views linked.
  // Unpinning detaches that pane so it pans/zooms/rotates independently
  // until re-pinned; pinning is per member, not a global on/off switch.
  const [unpinnedIds, setUnpinnedIds] = useState<ReadonlySet<number>>(() => new Set())
  const [saving, setSaving] = useState(false)

  // OSD handles arrive through onViewerReady. They are registered by image
  // id — not by pane — so when a member fails and the panes slide forward,
  // the surviving viewer keeps its registration (and its pan/zoom) in the
  // new slot instead of dropping out of the sync bridge.
  const viewersByImage = useRef(new Map<number, OpenSeadragon.Viewer>())
  const openedRef = useRef(new Set<number>())
  // Arm snapshot: every opened pane's viewport at the epoch anchor (all
  // panes opened / a pane re-pinned / reset). A leader's displacement from
  // its baseline is applied additively to each pinned follower's baseline —
  // the N-pane generalization of the original pairwise offset (#1561).
  const baselineRef = useRef(new Map<number, ViewportState>())
  const syncingRef = useRef(false)
  const unpinnedRef = useRef<ReadonlySet<number>>(unpinnedIds)
  // Bumped on every registration change to re-run the attach effect.
  const [readyTick, setReadyTick] = useState(0)

  // Failures, link state, viewer registrations and the armed baselines belong
  // to this collection — a different collection opened without an unmount
  // must not inherit them.
  const collectionId = collection.id
  const previousCollectionId = useRef(collectionId)
  useEffect(() => {
    if (previousCollectionId.current === collectionId) return
    previousCollectionId.current = collectionId
    setFailedIds(new Set())
    setUnpinnedIds(new Set())
    unpinnedRef.current = new Set()
    baselineRef.current.clear()
    viewersByImage.current.clear()
    openedRef.current.clear()
  }, [collectionId])

  useEffect(() => {
    unpinnedRef.current = unpinnedIds
  }, [unpinnedIds])

  const available = useMemo(
    () => images.filter((img) => !failedIds.has(img.id)),
    [images, failedIds],
  )
  const panes = useMemo(() => available.slice(0, MAX_PANES), [available])

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

  // Armed baselines and cached props of images that left the panes are
  // meaningless — drop both when the occupants change. (The surviving member
  // keeps its entry, so its viewer is not remounted by a new prop identity.)
  // Keyed on the occupant ids: a same-membership refresh (e.g. tile-token
  // renewal swapping image records) must not re-arm mid-gesture.
  const paneIds = panes.map((p) => p.id).join(',')
  useEffect(() => {
    baselineRef.current.clear()
    const ids = new Set(panes.map((p) => p.id))
    for (const { map } of [initialViewports.current, panePropsCache.current]) {
      for (const id of [...map.keys()]) {
        if (!ids.has(id)) map.delete(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneIds])

  const handleViewerReady = useCallback((imageId: number, viewer: OpenSeadragon.Viewer | null) => {
    if (viewer) {
      viewersByImage.current.set(imageId, viewer)
    } else {
      viewersByImage.current.delete(imageId)
      openedRef.current.delete(imageId)
    }
    setReadyTick((tick) => tick + 1)
  }, [])

  /**
   * Anchor the sync epoch: snapshot every opened pane's current viewport as
   * its baseline. A later leader event displaces each follower relative to
   * these baselines, so whatever alignment is on screen at arm time is kept —
   * for two panes this is exactly the pairwise offset the viewer used to
   * capture; for three/four it preserves each pane's position (#1561).
   */
  const armBaselines = useCallback(() => {
    baselineRef.current.clear()
    for (const id of openedRef.current) {
      const state = readViewport(viewersByImage.current.get(id) ?? null)
      if (state) baselineRef.current.set(id, state)
    }
  }, [])

  useEffect(() => {
    const detach: (() => void)[] = []
    for (const image of panes) {
      const viewer = viewersByImage.current.get(image.id)
      if (!viewer) {
        openedRef.current.delete(image.id)
        continue
      }
      // 'open' is a once-handler: it runs after ImageViewer's own open handler
      // (registered at viewer creation, before onViewerReady), so the saved
      // viewport restore has already settled when baselines are captured.
      const markOpened = () => {
        openedRef.current.add(image.id)
        if (openedRef.current.size >= 2) {
          // Re-arm whenever a pane joins: the newcomers' saved positions and
          // the already-linked panes' current positions become the epoch.
          armBaselines()
        }
      }
      const onViewportChange = () => {
        // An unpinned leader moves on its own; pinned leaders still drive
        // the remaining pinned panes (#1564).
        if (unpinnedRef.current.has(image.id) || syncingRef.current) return
        if (!openedRef.current.has(image.id)) return
        const leader = readViewport(viewer)
        const leaderBase = baselineRef.current.get(image.id)
        if (!leader) return
        if (!leaderBase) {
          // First armed event just locks the baselines — applying here would
          // be a no-op write, so capture and wait for the next change.
          armBaselines()
          return
        }
        const zoomRatio = leaderBase.zoom > 0 ? leader.zoom / leaderBase.zoom : 1
        const dx = leader.x - leaderBase.x
        const dy = leader.y - leaderBase.y
        const dRotation = (leader.rotation ?? 0) - (leaderBase.rotation ?? 0)
        syncingRef.current = true
        try {
          for (const other of panes) {
            if (other.id === image.id || !openedRef.current.has(other.id)) continue
            // Unpinned panes do not follow a leader's movement.
            if (unpinnedRef.current.has(other.id)) continue
            const followerBase = baselineRef.current.get(other.id)
            const follower = viewersByImage.current.get(other.id)
            if (!followerBase || !follower) continue
            applyTarget(follower, {
              zoom: followerBase.zoom * zoomRatio,
              x: followerBase.x + dx,
              y: followerBase.y + dy,
              rotation: (followerBase.rotation ?? 0) + dRotation,
            })
          }
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
  }, [panes, readyTick, armBaselines])

  /**
   * Toggle one pane's pin (#1564). Re-pinning re-arms the epoch so the pane
   * rejoins the linked group from wherever it is now — no snap back to the
   * position it held when it was unpinned.
   */
  const handlePinToggle = useCallback(
    (imageId: number) => {
      const rePinned = unpinnedRef.current.has(imageId)
      const next = new Set(unpinnedRef.current)
      if (rePinned) {
        next.delete(imageId)
      } else {
        next.add(imageId)
      }
      unpinnedRef.current = next
      setUnpinnedIds(next)
      if (rePinned) armBaselines()
    },
    [armBaselines],
  )

  const handleViewerError = useCallback(
    (image: ImageItem, message: string) => {
      onError(message)
      setFailedIds((prev) => (prev.has(image.id) ? prev : new Set(prev).add(image.id)))
    },
    [onError],
  )

  const handleSave = useCallback(async () => {
    const entries: Record<string, ViewportState> = {}
    for (const image of panes) {
      const state = readViewport(viewersByImage.current.get(image.id) ?? null)
      if (!state) return
      entries[String(image.id)] = {
        zoom: state.zoom,
        x: state.x,
        y: state.y,
        rotation: state.rotation ?? 0,
      }
    }
    setSaving(true)
    try {
      await onSaveViewport(entries)
    } catch (err) {
      onError(userMessage(err, 'Failed to save the collection view.'))
    } finally {
      setSaving(false)
    }
  }, [panes, onSaveViewport, onError])

  const handleReset = useCallback(() => {
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
      for (const image of panes) apply(image)
    } finally {
      syncingRef.current = false
    }
    armBaselines()
  }, [panes, collection.viewportState, armBaselines])

  if (available.length < 2) {
    return (
      <Box data-testid="synchronized-viewer-fallback">
        <Alert severity="info" sx={{ mt: 3 }}>
          {images.length === 0 && collection.memberCount > 0
            ? 'All images in this collection are currently restricted.'
            : images.length < 2
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

  const paneProps = panes.map((image) => ({ image, pane: panePropsFor(image) }))
  // Two panes keep the original side-by-side row; three or four render as a
  // 2×2 grid (SYNCHRONIZED_COLLECTION_MAX_IMAGES caps members at four).
  const gridPanes = panes.length > 2

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
        {/* Panes start pinned (linked); the per-pane pin in each viewport's
            top-right corner replaces the old global "Link views" switch
            (#1564). */}
        {images.length > panes.length && (
          <Typography variant="body2" color="text.secondary">
            Showing {panes.length} of {images.length}
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
        <Box
          sx={
            gridPanes
              ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }
              : { display: 'flex', gap: 2 }
          }
        >
          {paneProps.map(({ image, pane }) => {
            const pinned = !unpinnedIds.has(image.id)
            return (
              <Box key={image.id} sx={gridPanes ? { minWidth: 0 } : { flex: 1, minWidth: 0 }}>
                <Paper
                  elevation={3}
                  sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}
                >
                  <ImageViewer
                    tileSources={image.tileSources}
                    imageId={image.id}
                    categoryId={image.categoryId ?? undefined}
                    height={gridPanes ? '34vh' : '55vh'}
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
                  {/* Pin sits top-right of the viewport (the ImageViewer's
                      own toolbar docks bottom-left, so no overlap). Pinned =
                      linked; unpinning detaches this pane's pan/zoom/rotate
                      (#1564). */}
                  <Tooltip
                    title={
                      pinned
                        ? 'Unpin view — pan, zoom and rotate independently'
                        : 'Pin view — link pan, zoom and rotation with the other panes'
                    }
                  >
                    <IconButton
                      size="small"
                      aria-label={pinned ? `Unpin ${image.name}` : `Pin ${image.name}`}
                      aria-pressed={pinned}
                      onClick={() => handlePinToggle(image.id)}
                      data-testid={`pin-toggle-${image.id}`}
                      sx={(theme) => ({
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 30,
                        color: 'common.white',
                        bgcolor: alpha(theme.palette.common.black, pinned ? 0.55 : 0.3),
                        '&:hover': {
                          bgcolor: alpha(theme.palette.common.black, pinned ? 0.7 : 0.5),
                        },
                      })}
                    >
                      {pinned ? (
                        <PushPinIcon fontSize="small" />
                      ) : (
                        <PushPinOutlinedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
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
            )
          })}
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
