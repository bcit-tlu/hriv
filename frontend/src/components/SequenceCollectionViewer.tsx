import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { alpha, type Theme } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

import { type ApiImage } from '../api'
import type { Collection, ImageItem } from '../types'
import ImageViewer from './ImageViewer'
import RenewingThumbnail from './RenewingThumbnail'
import {
  canvasAnnotationsFromMetadata,
  lockedOverlaysFromMetadata,
  measurementFromMetadata,
  useStableJson,
} from './imageViewerUtils'

export interface SequenceCollectionViewerProps {
  collection: Collection
  /** `?item={image_id}` — desired current image; falls back to the first visible image. */
  itemId: number | null
  onSelectItem: (imageId: number) => void
  /** "Open image" → the regular `?image={id}` view where annotations can be edited. */
  onOpenImage: (image: ImageItem) => void
  /** Refresh a member's tokenized URLs after the viewer's tile-token renewal. */
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
  /**
   * Hidden collections desaturate the filmstrip (#1566) — the thumbnails are
   * the collection's "tiles", matching how hidden categories grey theirs.
   * The viewport imagery keeps its color, like the hidden image view.
   */
  hidden?: boolean
}

// How long edge nav stays after the last pointer event — mirrors OSD's
// autoHideControls fade delay so the buttons behave like the viewer toolbar.
const NAV_HIDE_DELAY_MS = 2000

/**
 * Selection ring drawn *inside* the thumbnail box via a negative
 * `outline-offset`. An outward `outline` sits outside the border box and gets
 * clipped asymmetrically by the strip's `overflow-x: auto` scroll port
 * (top/left/right edges have no padding), which cropped the active-image
 * highlight (#1561).
 */
const stripThumbRing = (isCurrent: boolean) =>
  ({
    outline: isCurrent ? '3px solid' : '1px solid',
    outlineColor: isCurrent ? 'primary.main' : 'divider',
    outlineOffset: isCurrent ? -3 : -1,
    // Keyboard focus needs its own cue — the selection outline overrides the
    // UA focus ring, so focus-visible swaps to a distinct info ring (the
    // selection cue returns on blur).
    '&:focus-visible': {
      outline: '3px solid',
      outlineColor: 'info.main',
      outlineOffset: -3,
    },
  }) as const

const navEdgeButton = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 30,
  color: 'common.white',
  bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.55),
  '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.75) },
  '&.Mui-disabled': {
    color: (theme: Theme) => alpha(theme.palette.common.white, 0.4),
    bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.35),
  },
} as const

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

export default function SequenceCollectionViewer({
  collection,
  itemId,
  onSelectItem,
  onOpenImage,
  onImageRenewed,
  onError,
  hidden = false,
}: SequenceCollectionViewerProps) {
  const images = collection.images
  // Images whose tiles failed mid-session (deleted / access lost / expired
  // renewal) are skipped by navigation and dimmed in the strip.
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(() => new Set())
  // Lightbox-style edge nav (#1561): Previous/Next overlay the viewport's
  // left/right edges and fade in on pointer activity like the OSD toolbar,
  // fading back out after a short idle. The buttons stay mounted (opacity +
  // pointer-events only) so keyboard focus can reveal them.
  const [navVisible, setNavVisible] = useState(false)
  const navHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Focus inside the nav holds it open regardless of pointer idle/leave.
  const navFocusedRef = useRef(false)
  const cancelNavHide = useCallback(() => {
    if (navHideTimer.current) clearTimeout(navHideTimer.current)
    navHideTimer.current = null
  }, [])
  const scheduleNavHide = useCallback(() => {
    cancelNavHide()
    navHideTimer.current = setTimeout(() => setNavVisible(false), NAV_HIDE_DELAY_MS)
  }, [cancelNavHide])
  const showNav = useCallback(() => {
    setNavVisible(true)
    // Pointer idle only fades the nav when no button holds keyboard focus.
    if (!navFocusedRef.current) scheduleNavHide()
  }, [scheduleNavHide])
  const hideNav = useCallback(() => {
    if (navFocusedRef.current) return
    cancelNavHide()
    setNavVisible(false)
  }, [cancelNavHide])
  // Keyboard focus holds the nav open without a hide clock; focus moving
  // between the two edge buttons must not start one either.
  const holdNavForFocus = useCallback(() => {
    navFocusedRef.current = true
    cancelNavHide()
    setNavVisible(true)
  }, [cancelNavHide])
  const releaseNavForBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        navFocusedRef.current = false
        scheduleNavHide()
      }
    },
    [scheduleNavHide],
  )
  useEffect(
    () => () => {
      if (navHideTimer.current) clearTimeout(navHideTimer.current)
    },
    [],
  )
  const regionRef = useRef<HTMLDivElement | null>(null)
  const focusedForCollection = useRef<number | null>(null)
  // Failed ids belong to this collection only — a different collection opened
  // without an unmount must not inherit them.
  const collectionId = collection.id
  const previousCollectionId = useRef(collectionId)
  useEffect(() => {
    if (previousCollectionId.current === collectionId) return
    previousCollectionId.current = collectionId
    setFailedIds(new Set())
  }, [collectionId])

  const available = useMemo(
    () => images.filter((img) => !failedIds.has(img.id)),
    [images, failedIds],
  )

  const currentIndex = useMemo(() => {
    if (available.length === 0) return 0
    const idx = itemId != null ? available.findIndex((img) => img.id === itemId) : -1
    return idx >= 0 ? idx : 0
  }, [available, itemId])
  const current = available[currentIndex] ?? null

  // Autofocus the region when a collection opens (#1564) so ←/→ step the
  // sequence immediately — no click needed first. Ref-guarded so switching
  // images does not steal focus, and a different collection re-focuses.
  useEffect(() => {
    if (current == null || focusedForCollection.current === collectionId) return
    focusedForCollection.current = collectionId
    // preventScroll: focusing must not scroll the collection header off the
    // top of the page before the user has seen it.
    regionRef.current?.focus({ preventScroll: true })
  }, [collectionId, current])

  // Stable across unrelated collection updates (e.g. tile-token renewal swaps
  // the member record): fresh identities would re-run ImageViewer's mount
  // effect (it depends on `initialOverlays`) and destroy the OSD viewer.
  const currentMetadata = current?.metadataExtra
  const lockedOverlays = useStableJson(
    JSON.stringify(currentMetadata?.locked_overlays ?? null),
    () => lockedOverlaysFromMetadata(currentMetadata),
  )
  const canvasAnnotations = useStableJson(
    JSON.stringify(currentMetadata?.canvas_annotations ?? null),
    () => canvasAnnotationsFromMetadata(currentMetadata),
  )
  const measurement = useStableJson(
    JSON.stringify([currentMetadata?.measurement_scale, currentMetadata?.measurement_unit]),
    () => measurementFromMetadata(currentMetadata),
  )

  const goTo = useCallback(
    (index: number) => {
      const target = available[index]
      if (target && target.id !== current?.id) onSelectItem(target.id)
    },
    [available, current?.id, onSelectItem],
  )

  const handleViewerError = useCallback(
    (message: string) => {
      onError(message)
      if (current == null) return
      setFailedIds((prev) => {
        if (prev.has(current.id)) return prev
        return new Set(prev).add(current.id)
      })
      // Skip to the nearest still-available image, preferring the next one.
      const nextIds = new Set(failedIds)
      nextIds.add(current.id)
      const idx = images.findIndex((img) => img.id === current.id)
      const after = images.slice(idx + 1).find((img) => !nextIds.has(img.id))
      const before = [...images.slice(0, idx)].reverse().find((img) => !nextIds.has(img.id))
      const next = after ?? before
      if (next) onSelectItem(next.id)
    },
    [current, failedIds, images, onError, onSelectItem],
  )

  // Arrow keys step the sequence. The capture-phase listener runs before the
  // event reaches OpenSeadragon's own keyboard panning, so ←/→ always mean
  // previous/next here and never pan the canvas (docs/collections.md).
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (isEditableTarget(event.target)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        goTo(currentIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        goTo(currentIndex + 1)
      }
    },
    [currentIndex, goTo],
  )

  if (images.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 3 }} data-testid="sequence-viewer-empty">
        {collection.memberCount > 0
          ? 'All images in this collection are currently restricted.'
          : 'This collection has no visible images to show.'}
      </Alert>
    )
  }

  if (current == null) {
    return (
      <Alert severity="error" sx={{ mt: 3 }} data-testid="sequence-viewer-unavailable">
        None of the images in this collection could be loaded. They may have been removed or you may
        no longer have access to them.
      </Alert>
    )
  }

  // Position is over the full member list — the strip still shows every
  // member (failed ones dimmed), so numbering must not renumber on failure.
  const position = `${images.indexOf(current) + 1} of ${images.length}`

  return (
    <Box
      data-testid="sequence-collection-viewer"
      onKeyDownCapture={handleKeyDownCapture}
      // Focusing the region (incl. the open-time autofocus) briefly reveals
      // the edge chevrons — the cue that ←/→ control the viewer (#1564).
      onFocus={showNav}
      ref={regionRef}
      tabIndex={-1}
      role="region"
      aria-label={`${collection.name} — sequence viewer`}
      sx={{ '&:focus': { outline: 'none' } }}
    >
      {/* The filmstrip sits above the viewer (#1564). Member management —
          reorder/add/remove — lives in the Manage dialog (#1566), so the
          strip is pure navigation. */}
      <Box
        data-testid="sequence-thumbnail-strip"
        sx={{
          display: 'flex',
          gap: 1,
          mt: 2,
          pb: 1,
          overflowX: 'auto',
          filter: hidden ? 'grayscale(100%)' : 'none',
        }}
      >
        {images.map((img) => {
          const isCurrent = img.id === current.id
          const isFailed = failedIds.has(img.id)
          return (
            <Box
              key={img.id}
              component="button"
              type="button"
              onClick={() => onSelectItem(img.id)}
              disabled={isFailed}
              aria-label={`Go to ${img.name}`}
              aria-current={isCurrent ? 'true' : undefined}
              sx={{
                ...stripThumbRing(isCurrent),
                flex: '0 0 auto',
                p: 0,
                border: 'none',
                bgcolor: 'transparent',
                opacity: isFailed ? 0.35 : 1,
                cursor: isFailed ? 'default' : 'pointer',
                borderRadius: 1,
                lineHeight: 0,
              }}
            >
              <RenewingThumbnail
                image={img}
                alt={img.name}
                onImageRenewed={onImageRenewed}
                draggable={false}
                sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
              />
            </Box>
          )
        })}
      </Box>

      <Paper
        elevation={3}
        data-testid="sequence-viewer-frame"
        sx={{ borderRadius: 2, overflow: 'hidden', position: 'relative' }}
        onPointerEnter={showNav}
        onPointerMove={showNav}
        onPointerDown={showNav}
        onPointerLeave={hideNav}
      >
        <ImageViewer
          key={current.id}
          tileSources={current.tileSources}
          imageId={current.id}
          categoryId={current.categoryId ?? undefined}
          height="60vh"
          initialOverlays={lockedOverlays}
          overlaysLocked={lockedOverlays != null}
          canvasAnnotations={canvasAnnotations}
          canEditContent={false}
          measurement={measurement}
          onTileSourceRenewed={onImageRenewed}
          onError={handleViewerError}
        />
        <Box
          data-testid="sequence-nav-overlay"
          style={{ opacity: navVisible ? 1 : 0 }}
          onFocusCapture={holdNavForFocus}
          onBlurCapture={releaseNavForBlur}
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            transition: 'opacity 0.25s ease',
          }}
        >
          <IconButton
            onClick={() => goTo(currentIndex - 1)}
            disabled={currentIndex <= 0}
            aria-label="Previous image"
            style={{ pointerEvents: navVisible ? 'auto' : 'none' }}
            sx={{ ...navEdgeButton, left: 8 }}
          >
            <ChevronLeftIcon fontSize="large" />
          </IconButton>
          <IconButton
            onClick={() => goTo(currentIndex + 1)}
            disabled={currentIndex >= available.length - 1}
            aria-label="Next image"
            style={{ pointerEvents: navVisible ? 'auto' : 'none' }}
            sx={{ ...navEdgeButton, right: 8 }}
          >
            <ChevronRightIcon fontSize="large" />
          </IconButton>
        </Box>
      </Paper>
      {/* Caption row mirrors the synchronized pane captions (#1564): the
          member name left, the position readout + Open image right. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {current.name}
          {!current.active ? ' (inactive)' : ''}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          aria-live="polite"
          data-testid="sequence-position"
          sx={{ flexShrink: 0 }}
        >
          {position}
        </Typography>
        <Button
          size="small"
          variant="text"
          endIcon={<OpenInNewIcon />}
          onClick={() => onOpenImage(current)}
          sx={{ flexShrink: 0 }}
        >
          Open image
        </Button>
      </Box>
    </Box>
  )
}
