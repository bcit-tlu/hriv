import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReorderIcon from '@mui/icons-material/Reorder'
import DoneIcon from '@mui/icons-material/Done'
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
}

const stripItemId = (imageId: number) => `seq-${imageId}`
const stripImageId = (id: string) => Number(id.slice(4))

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
        flex: '0 0 auto',
        opacity: isDragSource ? 0.4 : isFailed ? 0.35 : 1,
        cursor: isDragSource ? 'grabbing' : 'grab',
        borderRadius: 1,
        outline: isCurrent ? '3px solid' : '1px solid',
        outlineColor: isCurrent ? 'primary.main' : 'divider',
        outlineOffset: 1,
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
}: SequenceCollectionViewerProps) {
  const images = collection.images
  const canEdit = collection.permissions.canEdit
  const [reordering, setReordering] = useState(false)
  // Images whose tiles failed mid-session (deleted / access lost / expired
  // renewal) are skipped by navigation and dimmed in the strip.
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(() => new Set())
  // Failed ids and reorder mode belong to this collection only — a different
  // collection opened without an unmount must not inherit them.
  const collectionId = collection.id
  const previousCollectionId = useRef(collectionId)
  useEffect(() => {
    if (previousCollectionId.current === collectionId) return
    previousCollectionId.current = collectionId
    setFailedIds(new Set())
    setReordering(false)
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
        This collection has no visible images to show.
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
        <ButtonGroup size="small" variant="outlined" aria-label="Sequence navigation">
          <Button
            onClick={() => goTo(currentIndex - 1)}
            disabled={currentIndex <= 0}
            startIcon={<ChevronLeftIcon />}
            aria-label="Previous image"
          >
            Previous
          </Button>
          <Button
            onClick={() => goTo(currentIndex + 1)}
            disabled={currentIndex >= available.length - 1}
            endIcon={<ChevronRightIcon />}
            aria-label="Next image"
          >
            Next
          </Button>
        </ButtonGroup>
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
        {canEdit && (
          <Button
            size="small"
            variant={reordering ? 'contained' : 'outlined'}
            startIcon={reordering ? <DoneIcon /> : <ReorderIcon />}
            onClick={() => setReordering((v) => !v)}
            aria-pressed={reordering}
            data-testid="sequence-reorder-toggle"
          >
            {reordering ? 'Done' : 'Reorder'}
          </Button>
        )}
      </Box>

      <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
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
                  flex: '0 0 auto',
                  p: 0,
                  border: 'none',
                  bgcolor: 'transparent',
                  opacity: isFailed ? 0.35 : 1,
                  cursor: isFailed ? 'default' : 'pointer',
                  borderRadius: 1,
                  outline: isCurrent ? '3px solid' : '1px solid',
                  outlineColor: isCurrent ? 'primary.main' : 'divider',
                  outlineOffset: 1,
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
