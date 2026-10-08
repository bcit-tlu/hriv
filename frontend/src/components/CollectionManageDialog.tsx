import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CloseIcon from '@mui/icons-material/Close'
import SelectAllIcon from '@mui/icons-material/SelectAll'
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/react'

import { userMessage, type ApiImage } from '../api'
import { AuthContext } from '../authContextValue'
import { fitsCollectionCapacity } from '../useAddToCollection'
import type { Collection, ImageItem } from '../types'
import RenewingThumbnail from './RenewingThumbnail'

/**
 * Member-management surface for a collection (#1566) — a miniature Browse:
 * the full member list as filmstrip-size tiles (72×72 thumbs) that reorder
 * by drag-and-drop, a per-tile remove control, and a Multi-select mode that
 * picks members for a staged bulk remove (#1567). "Choose images" opens the
 * global search modal so picked images join through the standard add flow.
 *
 * All membership edits are **staged** (#1567): reorders, removals and search
 * additions mutate a local draft only — the detail page and filmstrip behind
 * the dialog do not change until **Done** commits the staged list through
 * `onSaveMembers` (a single whole-replace `PUT …/images` in the data hook,
 * so optimistic-concurrency `version` handling stays uniform). Closing
 * without Done discards the draft.
 */

/** Outcome of staging search picks into the draft (#1567). */
export type ManageStageResult =
  { status: 'added'; addedCount: number } | { status: 'already' } | { status: 'full' }

/** Stage search picks into the dialog's draft member list. */
export type StageAddImages = (images: ImageItem[]) => ManageStageResult

export interface CollectionManageDialogProps {
  open: boolean
  onClose: () => void
  /** Detail record — `null` renders an empty dialog (kept mounted for DnD). */
  collection: Collection | null
  /**
   * Commit the staged member list — fired once by Done. Receives the full
   * ordered id list (reorder + removals + additions in one shot).
   */
  onSaveMembers: (imageIds: number[]) => Promise<unknown>
  /**
   * "Choose images" opens the global search modal; the dialog hands over
   * its staging channel so picks land in the draft instead of persisting
   * immediately.
   */
  onAddImages?: (stageAdd: StageAddImages) => void
  /** Refresh a member's tokenized URLs after the thumb's renewal. */
  onImageRenewed: (image: ApiImage) => void
  onError: (message: string) => void
}

const ITEM_PREFIX = 'cmi-'
const itemIdFor = (imageId: number) => `${ITEM_PREFIX}${imageId}`
const imageIdFor = (id: string) => Number(id.slice(ITEM_PREFIX.length))

/** Shared chrome for the corner remove badge — the sortable tile renders it
    as a real IconButton, the drag overlay as a decorative copy. */
const removeBadgeSx = {
  position: 'absolute',
  top: -8,
  right: 0,
  bgcolor: 'background.paper',
  boxShadow: 1,
  width: 22,
  height: 22,
  '& svg': { fontSize: 14 },
} as const

/** Thumb + caption shared by the sortable tile and the drag overlay replica. */
function MemberTileFace({
  image,
  onImageRenewed,
}: {
  image: ImageItem
  onImageRenewed: (image: ApiImage) => void
}) {
  return (
    <>
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
    </>
  )
}

interface SortableMemberTileProps {
  image: ImageItem
  index: number
  disabled: boolean
  /** Selection mode (#1567): tiles toggle a removal set instead of dragging. */
  selecting: boolean
  selected: boolean
  onRemove: (image: ImageItem) => void
  onToggleSelect: (image: ImageItem) => void
  onImageRenewed: (image: ApiImage) => void
}

/** One member tile — a 72×72 thumb over a one-line caption, like a
    miniature Browse tile. The sortable `ref` rides the outer wrapper so the
    drag transform moves the corner remove badge with the tile; `handleRef`
    scopes the activator (role/tabindex/listeners) to the tile face only, so
    the badge inside the transformed wrapper stays outside the activator —
    no nested-interactive axe violation and no accidental drag pickup. */
function SortableMemberTile({
  image,
  index,
  disabled,
  selecting,
  selected,
  onRemove,
  onToggleSelect,
  onImageRenewed,
}: SortableMemberTileProps) {
  // Selecting disables the sortable entirely (#1567): a click toggles the
  // tile into the removal set instead of arming a drag — pointer AND
  // keyboard (the sensor returns early on `source.disabled`).
  const { ref, handleRef, isDragSource } = useSortable({
    id: itemIdFor(image.id),
    index,
    type: 'collection-manage-item',
    disabled: disabled || selecting,
  })
  const toggleSelect = useCallback(() => onToggleSelect(image), [image, onToggleSelect])
  // role=checkbox needs an explicit Space/Enter handler — native checks get
  // it free; this face is a div so keyboard parity lives here.
  const handleSelectKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        toggleSelect()
      }
    },
    [toggleSelect],
  )
  return (
    <Box
      ref={ref}
      data-testid={`manage-tile-${image.id}`}
      onClick={selecting ? toggleSelect : undefined}
      sx={{
        position: 'relative',
        width: 96,
        // The whole source dims mid-drag — face and corner badge together.
        opacity: isDragSource ? 0.4 : disabled ? 0.6 : 1,
        borderRadius: 1,
        outline: selecting && selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        // Air between the selection outline and the caption (#1567).
        p: selecting ? 0.5 : 0,
      }}
    >
      <Box
        ref={handleRef}
        // Focusable so the dnd-kit KeyboardSensor can pick the tile up —
        // declared explicitly rather than left to the a11y plugin's deferred
        // attribute injection (#1567). In selection mode the same element is
        // the toggle target, so its role/label swap to checkbox semantics.
        tabIndex={0}
        role={selecting ? 'checkbox' : 'button'}
        aria-checked={selecting ? selected : undefined}
        aria-label={selecting ? `Select ${image.name}` : `Drag to reorder ${image.name}`}
        onKeyDown={selecting ? handleSelectKeyDown : undefined}
        sx={{
          cursor: selecting ? 'pointer' : disabled ? 'default' : isDragSource ? 'grabbing' : 'grab',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'info.main' },
        }}
      >
        <MemberTileFace image={image} onImageRenewed={onImageRenewed} />
      </Box>
      {selecting ? (
        // A stock MUI checkbox as the visual state cue (#1567) — decorative:
        // the face carries the checkbox role, so this never needs to be
        // focusable or clickable itself. It sits ON the thumb's top-left
        // corner (inside the tile's click bounds — an overhanging checkbox
        // drops the clicks that land on its protruding half) and stays
        // medium-sized so the hit target reads as generous, not fiddly.
        <Checkbox
          checked={selected}
          tabIndex={-1}
          inputProps={{ 'aria-hidden': true }}
          data-testid={`select-indicator-${image.id}`}
          sx={{
            position: 'absolute',
            top: 4,
            left: 14,
            zIndex: 1,
            p: 0,
            bgcolor: 'background.paper',
            borderRadius: 0.5,
            border: 1,
            borderColor: 'divider',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <Tooltip title="Remove image">
          <IconButton
            size="small"
            aria-label={`Remove ${image.name} from collection`}
            disabled={disabled}
            onClick={() => onRemove(image)}
            sx={{
              ...removeBadgeSx,
              '&:hover': { bgcolor: 'error.light', color: 'error.contrastText' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

export default function CollectionManageDialog({
  open,
  onClose,
  collection,
  onSaveMembers,
  onAddImages,
  onImageRenewed,
  onError,
}: CollectionManageDialogProps) {
  const auth = useContext(AuthContext)
  const currentUser = auth?.currentUser ?? null
  // Draft member list — seeded from the collection per open session and
  // committed once by Done (#1567). `draftRef` is the synchronous mirror so
  // the stage-add channel (invoked by App while the modal is open) always
  // reads the latest draft without waiting for a render.
  const [draft, setDraft] = useState<ImageItem[]>(collection?.images ?? [])
  const draftRef = useRef<ImageItem[]>(draft)
  const seededFor = useRef<number | null>(null)
  // The member list as it stood when the draft was seeded — the Done diff
  // baseline. Kept separate from the live `collection.images` prop so an
  // external change landing mid-edit can't silently become part of the
  // commit (or make an untouched draft look dirty). (#1567)
  const [baselineIds, setBaselineIds] = useState<number[]>(() =>
    (collection?.images ?? []).map((img) => img.id),
  )
  const updateDraft = useCallback((next: ImageItem[]) => {
    draftRef.current = next
    setDraft(next)
  }, [])
  // Selection mode (#1567): a header toggle switches tiles from drag-order
  // controls into a multi-pick removal set — mouse, touch and keyboard all
  // share the same path (click/Space/Enter toggles, Remove stages once).
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  useEffect(() => {
    if (!open) {
      seededFor.current = null
      // A fresh open always starts outside selection mode with an empty set.
      setSelecting(false)
      setSelectedIds(new Set())
      return
    }
    if (collection != null && seededFor.current !== collection.id) {
      seededFor.current = collection.id
      // eslint-disable-next-line react-hooks/set-state-in-effect -- per-session draft seed
      setBaselineIds(collection.images.map((img) => img.id))
      updateDraft(collection.images)
    }
  }, [open, collection, updateDraft])

  const itemIds = useMemo(() => draft.map((img) => itemIdFor(img.id)), [draft])
  const [activeImage, setActiveImage] = useState<ImageItem | null>(null)
  const [saving, setSaving] = useState(false)

  const toggleSelectMode = useCallback(() => {
    setSelecting((s) => !s)
    // Entering or leaving always starts from a clean set.
    setSelectedIds(new Set())
  }, [])
  const toggleSelectImage = useCallback((image: ImageItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(image.id)) next.delete(image.id)
      else next.add(image.id)
      return next
    })
  }, [])
  // Count against the live draft so an id removed some other way can't
  // inflate the button label or the removal set.
  const selectedCount = useMemo(
    () => draft.reduce((n, img) => (selectedIds.has(img.id) ? n + 1 : n), 0),
    [draft, selectedIds],
  )
  const removeSelected = useCallback(() => {
    updateDraft(draftRef.current.filter((img) => !selectedIds.has(img.id)))
    setSelectedIds(new Set())
  }, [selectedIds, updateDraft])

  /** The staged list differs from the seed-time member list (order or set). */
  const dirty = useMemo(
    () => draft.length !== baselineIds.length || draft.some((img, i) => img.id !== baselineIds[i]),
    [draft, baselineIds],
  )

  // Hidden-member count comes from the loaded record, not the draft — staged
  // removes of visible members don't change how many are restricted away.
  const hiddenRestrictedCount = Math.max(
    0,
    (collection?.memberCount ?? 0) - (collection?.images.length ?? 0),
  )

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

  /**
   * Search picks arrive here (App routes them when this dialog opened the
   * modal). Dedupes against the draft and enforces the caller's image cap —
   * the same checks `addImagesToCollection` applies at persist time (#1567).
   */
  const stageAdd = useCallback<StageAddImages>(
    (images) => {
      const prev = draftRef.current
      const seen = new Set(prev.map((img) => img.id))
      const fresh = images.filter((img) => !seen.has(img.id))
      if (fresh.length === 0) return { status: 'already' }
      if (
        collection != null &&
        !fitsCollectionCapacity(
          collection,
          // Hidden restricted members still occupy capacity server-side —
          // reserve their slots so an accepted pick can't 422 on Done.
          prev.length + hiddenRestrictedCount,
          fresh.map((img) => img.id),
          currentUser?.role,
        )
      ) {
        return { status: 'full' }
      }
      updateDraft([...prev, ...fresh])
      return { status: 'added', addedCount: fresh.length }
    },
    [collection, currentUser?.role, hiddenRestrictedCount, updateDraft],
  )

  const remove = useCallback(
    (imageId: number) => {
      updateDraft(draftRef.current.filter((img) => img.id !== imageId))
    },
    [updateDraft],
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const sourceId = String(event.operation.source?.id)
    if (!sourceId.startsWith(ITEM_PREFIX)) return
    setActiveImage(draftRef.current.find((img) => itemIdFor(img.id) === sourceId) ?? null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveImage(null)
      const { operation } = event
      if (operation.canceled) return
      const sourceId = operation.source?.id
      if (sourceId == null) return
      const reordered = move(itemIds, event)
      if (reordered.length !== itemIds.length) return
      const byId = new Map(draftRef.current.map((img) => [img.id, img] as const))
      const next = reordered
        .map((id) => byId.get(imageIdFor(id)))
        .filter((img): img is ImageItem => img != null)
      if (next.every((img, i) => img.id === draftRef.current[i]?.id)) return
      updateDraft(next)
    },
    [itemIds, remove, updateDraft],
  )

  /** Done commits the staged list once; a clean dialog just closes (#1567). */
  const handleDone = useCallback(async () => {
    if (collection == null || !dirty) {
      onClose()
      return
    }
    setSaving(true)
    try {
      // Membership can change under an open dialog (e.g. a queued Browse add
      // lands mid-edit): merge those external changes instead of letting the
      // stale draft clobber them — drop baseline members removed elsewhere,
      // keep members added elsewhere (appended, matching the add semantics).
      const baselineSet = new Set(baselineIds)
      const liveIds = new Set(collection.images.map((img) => img.id))
      const externalAdds = collection.images.filter((img) => !baselineSet.has(img.id))
      const externalRemoves = new Set(baselineIds.filter((id) => !liveIds.has(id)))
      const draftIds = new Set(draftRef.current.map((img) => img.id))
      const merged = [
        ...draftRef.current.filter((img) => !externalRemoves.has(img.id)),
        ...externalAdds.filter((img) => !draftIds.has(img.id)),
      ]
      await onSaveMembers(merged.map((img) => img.id))
      onClose()
    } catch (err) {
      // Keep the dialog open with the draft intact so nothing is lost.
      onError(userMessage(err, 'Failed to save the collection members.'))
    } finally {
      setSaving(false)
    }
  }, [collection, dirty, baselineIds, onSaveMembers, onClose, onError])

  /** Esc/backdrop discard the draft — guarded when edits are staged. */
  const handleRequestClose = useCallback(() => {
    if (saving) return
    if (dirty && !window.confirm('Discard unsaved changes to this collection?')) return
    onClose()
  }, [dirty, saving, onClose])

  return (
    <Dialog
      open={open}
      onClose={handleRequestClose}
      maxWidth="lg"
      fullWidth
      data-testid="collection-manage"
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        Manage Collection Images{collection ? ` — ${collection.name}` : ''}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Selection mode toggle (#1567): switches tiles into a multi-pick
              removal set — drag-order is suspended while it's on. Stays
              visible while selecting even if the draft empties, so the mode
              is never stranded without its exit. */}
          {(draft.length > 0 || selecting) && (
            <Button
              size="small"
              variant={selecting ? 'contained' : 'outlined'}
              startIcon={<SelectAllIcon />}
              onClick={toggleSelectMode}
              aria-pressed={selecting}
              disabled={saving}
              data-testid="collection-manage-select-toggle"
            >
              Multi-select
            </Button>
          )}
          {onAddImages && (
            /* Labeled button with the Browse toolbar's Add-Images icon (#1567). */
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddPhotoAlternateIcon />}
              onClick={() => onAddImages(stageAdd)}
              disabled={saving}
              data-testid="collection-manage-add"
            >
              Choose images
            </Button>
          )}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ position: 'relative', minHeight: 220 }}>
        {draft.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selecting
              ? 'Click thumbnails to select them, then use the button below to stage the ' +
                'removal. Choose Multi-select again to go back to reordering.'
              : 'Drag thumbnails to reorder, or use a tile’s corner control to remove an image ' +
                'from the collection. Changes apply when you choose Done.'}
          </Typography>
        )}
        {hiddenRestrictedCount > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontStyle: 'italic' }}>
            {hiddenRestrictedCount} restricted {hiddenRestrictedCount === 1 ? 'image' : 'images'}{' '}
            not shown.
          </Typography>
        )}
        <DragDropProvider sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <>
            {draft.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="manage-empty">
                No images in this collection yet — use Choose images to pick some.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {draft.map((img, index) => (
                  <SortableMemberTile
                    key={img.id}
                    image={img}
                    index={index}
                    disabled={saving}
                    selecting={selecting}
                    selected={selectedIds.has(img.id)}
                    onRemove={(image) => remove(image.id)}
                    onToggleSelect={toggleSelectImage}
                    onImageRenewed={onImageRenewed}
                  />
                ))}
              </Box>
            )}
            {/* Overlay replica keeps the tile (and its corner badge) together
                under the pointer while the source stays dimmed in place —
                the same DragOverlay pattern as the Browse grid (#1567). */}
            <DragOverlay dropAnimation={null}>
              {activeImage ? (
                <Box
                  aria-hidden
                  sx={{
                    width: 96,
                    opacity: 0.9,
                    pointerEvents: 'none',
                    cursor: 'grabbing',
                    position: 'relative',
                  }}
                >
                  <MemberTileFace image={activeImage} onImageRenewed={onImageRenewed} />
                  <Box
                    component="span"
                    sx={{
                      ...removeBadgeSx,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                    }}
                  >
                    <CloseIcon />
                  </Box>
                </Box>
              ) : null}
            </DragOverlay>
          </>
        </DragDropProvider>
      </DialogContent>
      {/* Bulk remove — a dialog-spanning error button pinned above the
          actions, matching the Edit Image dialog's delete style (#1567).
          Staged removal needs no confirm step: Discard/Cancel restores. */}
      {selecting && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Divider sx={{ mb: 2 }} />
          <Button
            color="error"
            variant="outlined"
            fullWidth
            onClick={removeSelected}
            disabled={selectedCount === 0 || saving}
            data-testid="collection-manage-remove-selected"
          >
            Remove {selectedCount > 0 ? `${selectedCount} ` : ''}Selected{' '}
            {selectedCount === 1 ? 'Image' : 'Images'}
          </Button>
        </Box>
      )}
      <DialogActions>
        {dirty && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 2 }}>
            Unsaved changes — apply with Done.
          </Typography>
        )}
        <Button onClick={handleRequestClose} disabled={saving} data-testid="manage-cancel">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleDone()}
          disabled={saving}
          data-testid="manage-done"
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
