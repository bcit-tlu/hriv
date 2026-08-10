import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import {
  DragDropProvider,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
} from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import { CollisionPriority } from '@dnd-kit/abstract'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { Draggable } from '@dnd-kit/abstract'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/react'

import type { Category, Group, ImageItem, Program } from '../types'
import type { TileOrderItemRef } from '../api'
import type { ReorderDragContext } from '../tileOrdering'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import CategoryTile from './CategoryTile'
import ImageTile from './ImageTile'
import FileDropZone from './FileDropZone'
import { reorderCategories, reorderImages } from '../api'
import {
  emitReorderDiagnostic,
  newReorderOperationId,
  reorderErrorCode,
} from '../reorderDiagnostics'
import {
  buildTileItems,
  collectDescendantIds,
  DROP_PREFIX,
  farHalfReorderCollision,
  findCategory,
  nearHalfMoveCollision,
  orderTileItems,
  tileId,
} from './sortableTileGridUtils'
import type { TileItem } from './sortableTileGridUtils'

// Stable default so omitting `groups` cannot produce a fresh array on every
// render and defeat the render-callback memoization below.
const NO_GROUPS: Group[] = []

// Shared by the real reorder path and the in-flight discarded-drop
// accounting so the two order-change checks cannot drift apart.
function computeReorderedIds(
  items: TileItem[],
  event: DragEndEvent,
): { ids: string[]; reorderedIds: string[]; isNoOp: boolean } {
  const ids = items.map(tileId)
  const reorderedIds = move(ids, event)
  const isNoOp = reorderedIds.length === ids.length && reorderedIds.every((id, i) => id === ids[i])
  return { ids, reorderedIds, isNoOp }
}

interface SortableTileProps {
  id: string
  index: number
  disabled: boolean
  children: React.ReactNode
}

// Optimistic reflow: each tile is a sortable, so the grid reflows continuously
// during a drag to preview the resulting order. The dragged source dims and the
// optimistic-sorting plugin slides neighbours into place. Reflow only fires once
// the pointer crosses a tile's centre on the far side (`farHalfReorderCollision`);
// on the near half the detector returns no collision, so move wins there ("Move
// here" over a category tile) and the drag sits still over an image tile.
// See docs/drag-and-drop.md.
function SortableTile({ id, index, disabled, children }: SortableTileProps) {
  const { ref, isDragSource } = useSortable({
    id,
    index,
    disabled,
    type: 'tile',
    collisionDetector: farHalfReorderCollision,
  })

  return (
    <Box
      ref={ref}
      sx={{
        opacity: isDragSource ? 0.4 : 1,
        position: 'relative',
        width: 300,
        maxWidth: '100%',
        cursor: disabled ? undefined : isDragSource ? 'grabbing' : 'grab',
      }}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
    </Box>
  )
}

interface GridTileProps {
  item: TileItem
  index: number
  disabled: boolean
  renderCategoryTile: (cat: Category, wrapDroppable?: boolean) => React.ReactNode
  renderImageTile: (img: ImageItem) => React.ReactNode
}

// Memoized: grid-level state changes (drag start/end sets `activeItem`) must
// not re-render every mounted tile — at production scale (600+ tiles) that
// re-render is a main-thread stall at the start and end of every drag. The
// render callbacks are stable (useCallback), so a tile only re-renders when
// its own item, index, or disabled state changes.
const GridTile = memo(function GridTile({
  item,
  index,
  disabled,
  renderCategoryTile,
  renderImageTile,
}: GridTileProps) {
  return (
    <SortableTile id={tileId(item)} index={index} disabled={disabled}>
      {item.type === 'category'
        ? renderCategoryTile(item.data, true)
        : renderImageTile(item.data as ImageItem)}
    </SortableTile>
  )
})

interface DroppableCategoryZoneProps {
  categoryId: number
  disabled: boolean
  blockedIdsMap: Map<number, Set<number>>
  children: React.ReactNode
}

function DroppableCategoryZone({
  categoryId,
  disabled,
  blockedIdsMap,
  children,
}: DroppableCategoryZoneProps) {
  const acceptFilter = useCallback(
    (source: Draggable) => {
      const sourceId = String(source.id)
      if (!sourceId.startsWith('cat-')) return true

      const catId = Number(sourceId.slice(4))
      const blockedTargets = blockedIdsMap.get(catId)
      return !blockedTargets?.has(categoryId)
    },
    [blockedIdsMap, categoryId],
  )

  const { ref, isDropTarget } = useDroppable({
    id: `${DROP_PREFIX}${categoryId}`,
    disabled,
    collisionDetector: nearHalfMoveCollision,
    collisionPriority: CollisionPriority.High,
    accept: acceptFilter,
  })

  return (
    <Box
      ref={ref}
      role="region"
      aria-label="Move into category"
      sx={{
        position: 'relative',
        outline: '3px dashed',
        outlineColor: isDropTarget ? 'primary.main' : 'transparent',
        outlineOffset: 3,
        transform: isDropTarget ? 'scale(1.03)' : 'scale(1)',
        transition: 'outline-color 0.2s, transform 0.15s',
        borderRadius: 'inherit',
      }}
    >
      {children}
      {isDropTarget && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            borderRadius: 'inherit',
            pointerEvents: 'none',
            gap: 0.5,
          }}
        >
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <DriveFileMoveIcon sx={{ fontSize: 22 }} />
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main' }}>
            Move here
          </Typography>
        </Box>
      )}
    </Box>
  )
}

export interface SortableTileGridProps {
  allCategories: Category[]
  currentCategories: Category[]
  currentImages: ImageItem[]
  uncategorizedImages: ImageItem[]
  path: Category[]
  canEditContent: boolean
  fileDragActive: boolean
  programs: Program[]
  groups?: Group[]

  onCategoryClick: (cat: Category) => void
  onMoveCategory?: (cat: Category) => void
  onSetCardImage?: (categoryId: number, imageId: number | null) => void
  onEditCategoryName?: (cat: Category) => void
  onDropImageOnCategory?: (imageId: number, categoryId: number) => void
  onDropCategoryOnCategory?: (categoryId: number, targetCategoryId: number) => void
  onDropFilesOnCategory?: (categoryId: number, files: File[]) => void

  onImageClick: (img: ImageItem) => void
  onEditImageDetails?: (img: ImageItem) => void
  onFilesDrop: (files: File[]) => void
  onGridDragOver?: React.DragEventHandler
  onGridDrop?: React.DragEventHandler
  onReorderComplete?: () => Promise<void> | void
  onReorderError?: (err: unknown) => void

  /**
   * Coordinator-managed reordering (epic #975, issue #979). When provided,
   * the grid applies every accepted drag locally and reports the new order
   * to the coordinator; it never calls persistence APIs directly and never
   * discards a drop. `displayOrder` is the coordinator's newest order for
   * this scope (survives unmount/remount); `claimGeneration` guards against
   * a stale grid instance overwriting a remounted one.
   */
  tileOrdering?: {
    displayOrder: TileOrderItemRef[] | null
    reportOrder: (
      order: TileOrderItemRef[],
      generation?: number,
      dragContext?: ReorderDragContext,
    ) => void
    claimGeneration: () => number
  }
}

export default function SortableTileGrid({
  allCategories,
  currentCategories,
  currentImages,
  uncategorizedImages,
  path,
  canEditContent,
  fileDragActive,
  programs,
  groups = NO_GROUPS,
  onCategoryClick,
  onMoveCategory,
  onSetCardImage,
  onEditCategoryName,
  onDropImageOnCategory,
  onDropCategoryOnCategory,
  onDropFilesOnCategory,
  onImageClick,
  onEditImageDetails,
  onFilesDrop,
  onGridDragOver,
  onGridDrop,
  onReorderComplete,
  onReorderError,
  tileOrdering,
}: SortableTileGridProps) {
  const visibleImages = useMemo(
    () => (path.length === 0 ? [...uncategorizedImages, ...currentImages] : currentImages),
    [path.length, uncategorizedImages, currentImages],
  )

  const pathHiddenState = useMemo(() => getCategoryHiddenStateFromPath(path), [path])
  const inheritedProgramIds = useMemo(() => narrowProgramIds(path), [path])
  const inheritedGroupIds = useMemo(() => narrowGroupIds(path), [path])

  const parentId = path.length > 0 ? path[path.length - 1].id : null
  const [items, setItems] = useState<TileItem[]>(() => {
    const built = buildTileItems(currentCategories, visibleImages)
    return tileOrdering?.displayOrder ? orderTileItems(built, tileOrdering.displayOrder) : built
  })
  const [activeItem, setActiveItem] = useState<TileItem | null>(null)
  const gridGenerationRef = useRef<number | null>(null)
  const claimGeneration = tileOrdering?.claimGeneration
  // Claim a fresh grid-instance generation per scope so callbacks from an
  // unmounted grid (SPA navigation) cannot overwrite a remounted one.
  useLayoutEffect(() => {
    if (claimGeneration) gridGenerationRef.current = claimGeneration()
  }, [claimGeneration, parentId])
  const reorderInFlightRef = useRef(false)
  const discardedDropsRef = useRef(0)
  const activeOperationRef = useRef<string | null>(null)
  const pendingItemsRef = useRef<TileItem[] | null>(null)
  // Refs for async callback access (always reflect latest props)
  const currentCategoriesRef = useRef(currentCategories)
  const visibleImagesRef = useRef(visibleImages)
  const syncedCategoriesRef = useRef(currentCategories)
  const syncedVisibleImagesRef = useRef(visibleImages)
  const coordinatorOrder = tileOrdering?.displayOrder ?? null
  const syncedCoordinatorOrderRef = useRef(coordinatorOrder)

  useLayoutEffect(() => {
    currentCategoriesRef.current = currentCategories
    visibleImagesRef.current = visibleImages

    const membershipChanged =
      syncedCategoriesRef.current !== currentCategories ||
      syncedVisibleImagesRef.current !== visibleImages
    // Coordinator-authoritative order changes (saved responses or conflict
    // refreshes) re-sort the current tiles without a full category-tree
    // refresh.
    const orderChanged = syncedCoordinatorOrderRef.current !== coordinatorOrder
    if (!membershipChanged && !orderChanged) {
      return
    }
    syncedCategoriesRef.current = currentCategories
    syncedVisibleImagesRef.current = visibleImages
    syncedCoordinatorOrderRef.current = coordinatorOrder

    const built = buildTileItems(currentCategories, visibleImages)
    const nextItems = coordinatorOrder !== null ? orderTileItems(built, coordinatorOrder) : built
    if (reorderInFlightRef.current) {
      pendingItemsRef.current = nextItems
      return
    }
    pendingItemsRef.current = null
    setItems(nextItems)
  }, [currentCategories, visibleImages, coordinatorOrder])

  // Record navigation/unmount while a save is active: the operation's outcome
  // becomes unobservable to this component, which is one of the failure modes
  // tracked by epic #975.
  useEffect(() => {
    return () => {
      if (reorderInFlightRef.current && activeOperationRef.current !== null) {
        emitReorderDiagnostic({
          operationId: activeOperationRef.current,
          state: 'abandoned',
        })
      }
    }
  }, [])

  const blockedIdsMap = useMemo(() => {
    const map = new Map<number, Set<number>>()
    for (const cat of currentCategories) {
      const fullCat = findCategory(allCategories, cat.id)
      const blocked = fullCat ? collectDescendantIds(fullCat) : new Set<number>()
      blocked.add(cat.id)
      map.set(cat.id, blocked)
    }
    return map
  }, [allCategories, currentCategories])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const sourceId = String(event.operation.source?.id)
      const item = items.find((i) => tileId(i) === sourceId)
      setActiveItem(item ?? null)
    },
    [items],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveItem(null)

      const { operation } = event
      if (operation.canceled) return

      const source = operation.source
      const target = operation.target
      if (!source || !target) return

      const sourceId = String(source.id)
      const targetId = String(target.id)

      if (reorderInFlightRef.current) {
        // Current behavior: a drop during an in-flight save is silently
        // discarded (epic #975). Record reorder drops so they are observable;
        // move-into-category drops are outside the reorder lifecycle and
        // no-op drops (order unchanged, mirroring the idle-path filter) are
        // not reported as reorder operations.
        if (!targetId.startsWith(DROP_PREFIX)) {
          if (computeReorderedIds(items, event).isNoOp) return
          discardedDropsRef.current += 1
          emitReorderDiagnostic({
            operationId: newReorderOperationId(),
            state: 'ignored',
            scopeCategoryId: path.length > 0 ? path[path.length - 1].id : null,
            itemType: sourceId.startsWith('img-') ? 'image' : 'category',
            itemId: Number(sourceId.slice(4)),
            categoryCount: currentCategoriesRef.current.length,
            imageCount: visibleImagesRef.current.length,
            // Running count of drops discarded during the current save
            // (nothing is actually queued until #979 lands).
            queueDepth: discardedDropsRef.current,
          })
        }
        return
      }

      if (targetId.startsWith(DROP_PREFIX)) {
        const targetCatId = Number(targetId.slice(DROP_PREFIX.length))
        if (sourceId.startsWith('img-')) {
          onDropImageOnCategory?.(Number(sourceId.slice(4)), targetCatId)
        } else if (sourceId.startsWith('cat-')) {
          onDropCategoryOnCategory?.(Number(sourceId.slice(4)), targetCatId)
        }
        return
      }

      // ── Reorder (optimistic sortable reflow) ──
      // The target is the sortable tile the pointer settled on. `move`
      // derives the new order from the source's reflowed sortable index,
      // so the committed order matches the on-screen preview exactly.
      const { ids, reorderedIds, isNoOp } = computeReorderedIds(items, event)
      if (isNoOp) return
      const itemById = new Map(items.map((item) => [tileId(item), item] as const))
      const reordered = reorderedIds
        .map((id) => itemById.get(id))
        .filter((item): item is TileItem => item !== undefined)
      if (reordered.length !== items.length) return

      if (tileOrdering) {
        // Coordinator mode (issue #979): apply locally and report the new
        // order. Queueing, coalescing, persistence, and save-state UX are
        // owned above the grid; nothing is discarded here.
        setItems(reordered)
        tileOrdering.reportOrder(
          reordered.map((item) => ({ type: item.type, id: item.data.id })),
          gridGenerationRef.current ?? undefined,
          // Drag detail rides along so lifecycle telemetry keeps per-drag
          // context (which tile moved, from/to index) on this surface.
          {
            itemType: sourceId.startsWith('img-') ? 'image' : 'category',
            itemId: Number(sourceId.slice(4)),
            fromIndex: ids.indexOf(sourceId),
            toIndex: reorderedIds.indexOf(sourceId),
          },
        )
        return
      }

      const operationId = newReorderOperationId()
      const startedAt = performance.now()
      reorderInFlightRef.current = true
      discardedDropsRef.current = 0
      activeOperationRef.current = operationId
      setItems(reordered)

      const catUpdates: Array<{
        id: number
        parent_id: number | null
        sort_order: number
      }> = []
      const imgUpdates: Array<{ id: number; sort_order: number }> = []

      reordered.forEach((item, index) => {
        if (item.type === 'category') {
          catUpdates.push({
            id: item.data.id,
            parent_id: parentId,
            sort_order: index,
          })
        } else {
          imgUpdates.push({
            id: item.data.id,
            sort_order: index,
          })
        }
      })

      const itemType =
        catUpdates.length > 0 && imgUpdates.length > 0
          ? 'mixed'
          : sourceId.startsWith('img-')
            ? 'image'
            : 'category'
      emitReorderDiagnostic({
        operationId,
        state: 'submitted',
        scopeCategoryId: parentId,
        itemType,
        itemId: Number(sourceId.slice(4)),
        fromIndex: ids.indexOf(sourceId),
        toIndex: reorderedIds.indexOf(sourceId),
        categoryCount: catUpdates.length,
        imageCount: imgUpdates.length,
        queueDepth: 0,
      })

      try {
        const promises: Promise<void>[] = []
        if (catUpdates.length > 0) promises.push(reorderCategories(catUpdates, operationId))
        if (imgUpdates.length > 0) promises.push(reorderImages(imgUpdates, operationId))

        const results = await Promise.allSettled(promises)
        // Persistence-only duration: terminal events measure the same interval
        // on every path (the follow-up refresh is excluded).
        const persistenceDurationMs = performance.now() - startedAt
        const failed = results.filter((r) => r.status === 'rejected')

        if (failed.length > 0) {
          const err =
            (failed[0] as PromiseRejectedResult).reason ?? new Error('Reorder partially failed')
          console.error('Reorder partially failed', failed)
          emitReorderDiagnostic({
            operationId,
            state: 'failed',
            scopeCategoryId: parentId,
            itemType,
            categoryCount: catUpdates.length,
            imageCount: imgUpdates.length,
            durationMs: persistenceDurationMs,
            errorCode: reorderErrorCode(err),
          })
          reorderInFlightRef.current = false
          activeOperationRef.current = null
          pendingItemsRef.current = null
          setItems((current) => (current === reordered ? items : current))
          onReorderError?.(err)
          onReorderComplete?.()
          return
        }

        // Keep the in-flight flag raised until the caller
        // refreshes categories so the render-time guard
        // doesn't rebuild items from stale sort_order.
        try {
          await onReorderComplete?.()
        } catch {
          /* handled inside the callback */
        }
        emitReorderDiagnostic({
          operationId,
          state: 'committed',
          scopeCategoryId: parentId,
          itemType,
          categoryCount: catUpdates.length,
          imageCount: imgUpdates.length,
          durationMs: persistenceDurationMs,
        })
        reorderInFlightRef.current = false
        activeOperationRef.current = null
        setItems(
          pendingItemsRef.current ??
            buildTileItems(currentCategoriesRef.current, visibleImagesRef.current),
        )
        pendingItemsRef.current = null
      } catch (err) {
        console.error('Failed to persist reorder', err)
        emitReorderDiagnostic({
          operationId,
          state: 'failed',
          scopeCategoryId: parentId,
          itemType,
          categoryCount: catUpdates.length,
          imageCount: imgUpdates.length,
          durationMs: performance.now() - startedAt,
          errorCode: reorderErrorCode(err),
        })
        reorderInFlightRef.current = false
        activeOperationRef.current = null
        pendingItemsRef.current = null
        setItems((current) => (current === reordered ? items : current))
        onReorderError?.(err)
        onReorderComplete?.()
      }
    },
    [
      items,
      path,
      parentId,
      tileOrdering,
      onDropCategoryOnCategory,
      onDropImageOnCategory,
      onReorderComplete,
      onReorderError,
    ],
  )

  const renderCategoryTile = useCallback(
    (cat: Category, wrapDroppable = false) => {
      const tile = (
        <CategoryTile
          category={cat}
          onClick={onCategoryClick}
          onMove={canEditContent ? onMoveCategory : undefined}
          onSetCardImage={canEditContent ? onSetCardImage : undefined}
          onEditName={canEditContent ? onEditCategoryName : undefined}
          programs={programs}
          inheritedProgramIds={inheritedProgramIds}
          groups={groups}
          inheritedGroupIds={inheritedGroupIds}
          parentHidden={pathHiddenState.hidden}
          inheritedHidden={pathHiddenState.hidden}
          onDropFiles={canEditContent ? onDropFilesOnCategory : undefined}
        />
      )

      if (!wrapDroppable) return tile

      return (
        <DroppableCategoryZone
          categoryId={cat.id}
          disabled={!canEditContent}
          blockedIdsMap={blockedIdsMap}
        >
          {tile}
        </DroppableCategoryZone>
      )
    },
    [
      canEditContent,
      blockedIdsMap,
      programs,
      groups,
      inheritedProgramIds,
      inheritedGroupIds,
      pathHiddenState,
      onCategoryClick,
      onMoveCategory,
      onSetCardImage,
      onEditCategoryName,
      onDropFilesOnCategory,
    ],
  )

  const renderImageTile = useCallback(
    (img: ImageItem) => (
      <ImageTile
        image={img}
        onClick={onImageClick}
        onEditDetails={canEditContent ? onEditImageDetails : undefined}
        categoryHidden={pathHiddenState.hidden}
      />
    ),
    [canEditContent, pathHiddenState, onImageClick, onEditImageDetails],
  )

  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: (event: PointerEvent) => {
          if (event.pointerType === 'touch') {
            return [
              new PointerActivationConstraints.Delay({
                value: 250,
                tolerance: 5,
              }),
            ]
          }
          return [
            new PointerActivationConstraints.Distance({
              value: 8,
            }),
          ]
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

  return (
    <DragDropProvider sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Box
        role="region"
        aria-label="Sortable tile grid"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}
        onDragOver={onGridDragOver}
        onDrop={onGridDrop}
      >
        {items.map((item, index) => (
          <GridTile
            key={tileId(item)}
            item={item}
            index={index}
            disabled={!canEditContent}
            renderCategoryTile={renderCategoryTile}
            renderImageTile={renderImageTile}
          />
        ))}
        {canEditContent && <FileDropZone isDragActive={fileDragActive} onDrop={onFilesDrop} />}
      </Box>

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <Box
            sx={{
              opacity: 0.85,
              width: 300,
              pointerEvents: 'none',
              cursor: 'grabbing',
            }}
          >
            {activeItem.type === 'category'
              ? renderCategoryTile(activeItem.data)
              : renderImageTile(activeItem.data)}
          </Box>
        ) : null}
      </DragOverlay>
    </DragDropProvider>
  )
}
