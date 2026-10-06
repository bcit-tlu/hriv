import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragEndEvent } from '@dnd-kit/react'

import { userMessage, type ApiImage } from '../api'
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
  /** Persist a new member order; the hook applies it optimistically and rolls back on reject. */
  onReorder: (imageIds: number[]) => Promise<unknown>
  /** Refresh a member's tokenized URLs after the viewer's tile-token renewal. */
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
  /**
   * Reorder mode — controlled by the parent (#1559): the Reorder/Done
   * toggle lives in the detail header between Move and Edit. The viewer
   * still drops out of reorder when the collection changes.
   */
  reordering: boolean
  onReorderingChange: (reordering: boolean) => void
}

const stripItemId = (imageId: number) => `seq-${imageId}`
const stripImageId = (id: string) => Number(id.slice(4))

// How long edge nav stays after the last pointer event — mirrors OSD's
// autoHideControls fade delay so the buttons behave like the viewer toolbar.
const NAV_HIDE_DELAY_MS = 2000

/**
 * Selection ring drawn *inside* the thumbnail box. An `outline` sits outside
 * the border box and gets clipped asymmetrically by the strip's
 * `overflow-x: auto` scroll port (top/left/right edges have no padding), which
 * cropped the active-image highlight (#1561).
 */
const stripThumbRing = (isCurrent: boolean) =>
  ({
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 1,
      border: isCurrent ? '3px solid' : '1px solid',
      borderColor: isCurrent ? 'primary.main' : 'divider',
      pointerEvents: 'none',
    },
  }) as const

const navEdgeButton = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 30,
  color: 'common.white',
  bgcolor: 'rgba(0, 0, 0, 0.55)',
  '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.75)' },
  '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.4)', bgcolor: 'rgba(0, 0, 0, 0.35)' },
} as const

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

interface SortableStripThumbProps {
  id: string
  index: number
  image: ImageItem
  isCurrent: boolean
  isFailed: boolean
  onImageRenewed: (image: ApiImage) => void
}

/** Reorder-mode strip item: a drag handle, not a navigation button. */
function SortableStripThumb({
  id,
  index,
  image,
  isCurrent,
  isFailed,
  onImageRenewed,
}: SortableStripThumbProps) {
  const { ref, isDragSource } = useSortable({
    id,
    index,
    type: 'sequence-strip-item',
  })
  return (
    <Box
      ref={ref}
      // Focusable so the dnd-kit KeyboardSensor can pick it up for reorder.
      tabIndex={0}
      role="button"
      aria-label={`Drag to reorder ${image.name}`}
      sx={{
        ...stripThumbRing(isCurrent),
        flex: '0 0 auto',
        opacity: isDragSource ? 0.4 : isFailed ? 0.35 : 1,
        cursor: isDragSource ? 'grabbing' : 'grab',
        borderRadius: 1,
        lineHeight: 0,
      }}
    >
      <RenewingThumbnail
        image={image}
        alt={image.name}
        onImageRenewed={onImageRenewed}
        draggable={false}
        sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
      />
    </Box>
  )
}

export default function SequenceCollectionViewer({
  collection,
  itemId,
  onSelectItem,
  onOpenImage,
  onReorder,
  onImageRenewed,
  onError,
  reordering,
  onReorderingChange,
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
  const scheduleNavHide = useCallback(() => {
    if (navHideTimer.current) clearTimeout(navHideTimer.current)
    navHideTimer.current = setTimeout(() => setNavVisible(false), NAV_HIDE_DELAY_MS)
  }, [])
  const showNav = useCallback(() => {
    setNavVisible(true)
    scheduleNavHide()
  }, [scheduleNavHide])
  const hideNav = useCallback(() => {
    if (navHideTimer.current) clearTimeout(navHideTimer.current)
    navHideTimer.current = null
    setNavVisible(false)
  }, [])
  useEffect(
    () => () => {
      if (navHideTimer.current) clearTimeout(navHideTimer.current)
    },
    [],
  )
  // Failed ids and reorder mode belong to this collection only — a different
  // collection opened without an unmount must not inherit them.
  const collectionId = collection.id
  const previousCollectionId = useRef(collectionId)
  useEffect(() => {
    if (previousCollectionId.current === collectionId) return
    previousCollectionId.current = collectionId
    setFailedIds(new Set())
    onReorderingChange(false)
  }, [collectionId, onReorderingChange])

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

  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: (event: PointerEvent) => {
          if (event.pointerType === 'touch') {
            return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
          }
          return [new PointerActivationConstraints.Distance({ value: 8 })]
        },
        preventActivation: (event: PointerEvent) => {
          const target = event.target
          if (!(target instanceof Element)) return false
          return Boolean(target.closest('.MuiIconButton-root'))
        },
      }),
      KeyboardSensor,
    ],
    [],
  )

  const stripIds = useMemo(() => images.map((img) => stripItemId(img.id)), [images])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { operation } = event
      if (operation.canceled) return
      const reordered = move(stripIds, event)
      if (reordered.length !== stripIds.length) return
      const imageIds = reordered.map(stripImageId)
      if (imageIds.every((id, i) => id === images[i]?.id)) return
      onReorder(imageIds).catch((err: unknown) => {
        onError(userMessage(err, 'Failed to reorder collection images.'))
      })
    },
    [images, onError, onReorder, stripIds],
  )

  // Arrow keys step the sequence. The capture-phase listener runs before the
  // event reaches OpenSeadragon's own keyboard panning, so ←/→ always mean
  // previous/next here and never pan the canvas (docs/collections.md). In
  // reorder mode the keys belong to the dnd-kit KeyboardSensor instead.
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (reordering || isEditableTarget(event.target)) return
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
    [currentIndex, goTo, reordering],
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
    <Box data-testid="sequence-collection-viewer" onKeyDownCapture={handleKeyDownCapture}>
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
        <Typography
          variant="body2"
          color="text.secondary"
          aria-live="polite"
          data-testid="sequence-position"
        >
          {position}
        </Typography>
        <Button
          size="small"
          variant="text"
          endIcon={<OpenInNewIcon />}
          onClick={() => onOpenImage(current)}
        >
          Open image
        </Button>
        {/* The Reorder/Done toggle lives in the detail header between Move
            and Edit (#1559); `reordering` is a controlled prop. */}
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
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            transition: 'opacity 0.25s ease',
            '&:focus-within': { opacity: 1 },
          }}
        >
          <IconButton
            onClick={() => goTo(currentIndex - 1)}
            disabled={currentIndex <= 0}
            aria-label="Previous image"
            onFocus={showNav}
            onBlur={scheduleNavHide}
            style={{ pointerEvents: navVisible ? 'auto' : 'none' }}
            sx={{ ...navEdgeButton, left: 8 }}
          >
            <ChevronLeftIcon fontSize="large" />
          </IconButton>
          <IconButton
            onClick={() => goTo(currentIndex + 1)}
            disabled={currentIndex >= available.length - 1}
            aria-label="Next image"
            onFocus={showNav}
            onBlur={scheduleNavHide}
            style={{ pointerEvents: navVisible ? 'auto' : 'none' }}
            sx={{ ...navEdgeButton, right: 8 }}
          >
            <ChevronRightIcon fontSize="large" />
          </IconButton>
        </Box>
      </Paper>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {current.name}
        {!current.active ? ' (inactive)' : ''}
      </Typography>

      {reordering && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Drag the thumbnails to reorder the sequence, then choose Done.
        </Typography>
      )}
      <Box
        data-testid="sequence-thumbnail-strip"
        sx={{
          display: 'flex',
          gap: 1,
          mt: 2,
          pb: 1,
          overflowX: 'auto',
        }}
      >
        {reordering ? (
          <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
            {images.map((img, index) => (
              <SortableStripThumb
                key={img.id}
                id={stripItemId(img.id)}
                index={index}
                image={img}
                isCurrent={img.id === current.id}
                isFailed={failedIds.has(img.id)}
                onImageRenewed={onImageRenewed}
              />
            ))}
          </DragDropProvider>
        ) : (
          images.map((img) => {
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
          })
        )}
      </Box>
    </Box>
  )
}
