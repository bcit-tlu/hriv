import { useCallback, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { alpha, type Theme } from '@mui/material/styles'
import { DragDropProvider, KeyboardSensor, PointerSensor, useDroppable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/react'

import { userMessage, type ApiImage } from '../api'
import type { Collection, ImageItem } from '../types'
import RenewingThumbnail from './RenewingThumbnail'

/**
 * Member-management surface for a collection (#1566) — a miniature Browse:
 * the full member list as filmstrip-size tiles (72×72 thumbs) that reorder
 * by drag-and-drop, a per-tile remove control, and a trash drop-zone that
 * appears while dragging. "+" opens the global search modal so picked
 * images join through the standard add flow.
 *
 * Reorder and remove both whole-replace `PUT …/images` via the parent's
 * `useCollectionsData` handlers, so optimistic-concurrency `version`
 * handling stays uniform.
 */
export interface CollectionManageDialogProps {
  open: boolean
  onClose: () => void
  /** Detail record — `null` renders an empty dialog (kept mounted for DnD). */
  collection: Collection | null
  /** Persist a new member order (optimistic + rollback in the data hook). */
  onReorder: (imageIds: number[]) => Promise<unknown>
  /** Remove members — the trash drop and the per-tile control share this. */
  onRemoveImages: (imageIds: number[]) => Promise<unknown>
  /** "+" opens the global search modal targeted at this collection. */
  onAddImages?: () => void
  /** Refresh a member's tokenized URLs after the thumb's renewal. */
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

const ITEM_PREFIX = 'cmi-'
const itemIdFor = (imageId: number) => `${ITEM_PREFIX}${imageId}`
const imageIdFor = (id: string) => Number(id.slice(ITEM_PREFIX.length))
const TRASH_ID = 'collection-manage-trash'

interface SortableMemberTileProps {
  image: ImageItem
  index: number
  removing: boolean
  onRemove: (image: ImageItem) => void
  onImageRenewed: (image: ApiImage) => void
}

/** One member tile — a 72×72 thumb over a one-line caption, like a
    miniature Browse tile. The corner button removes without dragging;
    `preventActivation` on IconButton keeps it from starting a drag. */
function SortableMemberTile({
  image,
  index,
  removing,
  onRemove,
  onImageRenewed,
}: SortableMemberTileProps) {
  const { ref, isDragSource } = useSortable({
    id: itemIdFor(image.id),
    index,
    type: 'collection-manage-item',
  })
  return (
    // The remove control is a positioned *sibling* of the sortable tile, not
    // a descendant — a focusable button inside a role=button trips axe's
    // nested-interactive rule (#1566).
    <Box sx={{ position: 'relative', width: 96 }}>
      <Box
        ref={ref}
        // Focusable so the dnd-kit KeyboardSensor can pick the tile up.
        tabIndex={0}
        role="button"
        aria-label={`Drag to reorder ${image.name}`}
        data-testid={`manage-tile-${image.id}`}
        sx={{
          opacity: isDragSource ? 0.4 : removing ? 0.5 : 1,
          cursor: isDragSource ? 'grabbing' : 'grab',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'info.main' },
        }}
      >
        <Box sx={{ width: 72, mx: 'auto' }}>
          <RenewingThumbnail
            image={image}
            // Presentational — the caption below and the tile's aria-label
            // already carry the name (image-redundant-alt).
            alt=""
            onImageRenewed={onImageRenewed}
            draggable={false}
            sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, display: 'block' }}
          />
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          align="center"
          noWrap
          sx={{ display: 'block', mt: 0.5 }}
        >
          {image.name}
        </Typography>
      </Box>
      <IconButton
        size="small"
        aria-label={`Remove ${image.name} from collection`}
        disabled={removing}
        onClick={() => onRemove(image)}
        sx={{
          position: 'absolute',
          top: -8,
          right: 0,
          bgcolor: 'background.paper',
          boxShadow: 1,
          width: 22,
          height: 22,
          '&:hover': { bgcolor: 'error.light', color: 'error.contrastText' },
          '& svg': { fontSize: 14 },
        }}
      >
        <CloseIcon />
      </IconButton>
    </Box>
  )
}

export default function CollectionManageDialog({
  open,
  onClose,
  collection,
  onReorder,
  onRemoveImages,
  onAddImages,
  onImageRenewed,
  onError,
}: CollectionManageDialogProps) {
  const images = useMemo(() => collection?.images ?? [], [collection])
  const itemIds = useMemo(() => images.map((img) => itemIdFor(img.id)), [images])
  const [dragging, setDragging] = useState(false)
  const [removingIds, setRemovingIds] = useState<ReadonlySet<number>>(new Set())

  // Same sensor policy as SortableTileGrid (#1533): 8px pointer distance so
  // clicks still reach the corner control, 250ms touch delay, and no
  // activation on IconButton targets.
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: (event: PointerEvent) => {
          if (event.pointerType === 'touch') {
            return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 8 })]
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

  const remove = useCallback(
    (imageId: number) => {
      setRemovingIds((prev) => new Set(prev).add(imageId))
      void onRemoveImages([imageId])
        .catch((err: unknown) => {
          onError(userMessage(err, 'Unable to remove the image from the collection.'))
        })
        .finally(() =>
          setRemovingIds((prev) => {
            const next = new Set(prev)
            next.delete(imageId)
            return next
          }),
        )
    },
    [onRemoveImages, onError],
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // Only member tiles arm the trash — the droppable's `accept` double-checks.
    if (String(event.operation.source?.id).startsWith(ITEM_PREFIX)) setDragging(true)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(false)
      const { operation } = event
      if (operation.canceled) return
      const sourceId = operation.source?.id
      if (sourceId == null) return
      // The trash zone removes the member — same whole-replace path as the
      // per-tile control (#1566).
      if (operation.target?.id === TRASH_ID) {
        remove(imageIdFor(String(sourceId)))
        return
      }
      const reordered = move(itemIds, event)
      if (reordered.length !== itemIds.length) return
      const imageIds = reordered.map(imageIdFor)
      if (imageIds.every((id, i) => id === images[i]?.id)) return
      void onReorder(imageIds).catch((err: unknown) =>
        onError(userMessage(err, 'Failed to reorder collection images.')),
      )
    },
    [itemIds, images, onReorder, onError, remove],
  )

  // The trash drop-zone is mounted permanently so it is a registered
  // droppable throughout the drag, but only enables/appears mid-drag.
  const { ref: trashRef, isDropTarget: overTrash } = useDroppable({
    id: TRASH_ID,
    disabled: !dragging,
    accept: (source) => String(source.id).startsWith(ITEM_PREFIX),
  })

  const hiddenRestrictedCount = (collection?.memberCount ?? 0) - images.length

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth data-testid="collection-manage">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Manage images{collection ? ` — ${collection.name}` : ''}
        {onAddImages && (
          <IconButton
            aria-label="Add images to collection"
            onClick={onAddImages}
            color="primary"
            data-testid="collection-manage-add"
          >
            <AddIcon />
          </IconButton>
        )}
      </DialogTitle>
      <DialogContent sx={{ position: 'relative', minHeight: 220 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Drag thumbnails to reorder. Drag onto the bin, or use a tile's corner control, to remove
          an image from the collection.
        </Typography>
        {hiddenRestrictedCount > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontStyle: 'italic' }}>
            {hiddenRestrictedCount} restricted {hiddenRestrictedCount === 1 ? 'image' : 'images'}{' '}
            not shown.
          </Typography>
        )}
        {images.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="manage-empty">
            No images in this collection yet — use the add button to pick some.
          </Typography>
        ) : (
          <DragDropProvider
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {images.map((img, index) => (
                <SortableMemberTile
                  key={img.id}
                  image={img}
                  index={index}
                  removing={removingIds.has(img.id)}
                  onRemove={(image) => remove(image.id)}
                  onImageRenewed={onImageRenewed}
                />
              ))}
            </Box>
          </DragDropProvider>
        )}
        {/* Trash drop-zone (#1566): revealed mid-drag, sticky at the bottom
            of the scroll area so it stays reachable on long lists. */}
        <Box
          ref={trashRef}
          aria-hidden={!dragging}
          data-testid="collection-manage-trash"
          sx={{
            position: 'sticky',
            bottom: 8,
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            mt: 3,
            mx: 'auto',
            width: 200,
            py: 1.5,
            border: '2px dashed',
            borderRadius: 2,
            borderColor: overTrash ? 'error.main' : 'divider',
            bgcolor: (theme: Theme) =>
              overTrash ? alpha(theme.palette.error.main, 0.12) : theme.palette.background.paper,
            color: overTrash ? 'error.main' : 'text.secondary',
            opacity: dragging ? 1 : 0,
            transition: 'opacity 0.2s, border-color 0.15s',
            pointerEvents: 'none',
          }}
        >
          <DeleteOutlineIcon fontSize="large" />
          <Typography variant="caption">Drop here to remove</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
