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
import { DndMonitor, logDrag } from '../dndInstrumentation'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import CategoryTile from './CategoryTile'
import ImageTile from './ImageTile'
import FileDropZone from './FileDropZone'
import {
  buildDescendantMap,
  buildTileItems,
  DROP_PREFIX,
  farHalfReorderCollision,
  nearHalfMoveCollision,
  orderTileItems,
  tileId,
} from './sortableTileGridUtils'
import type { TileItem } from './sortableTileGridUtils'

// Stable default so omitting `groups` cannot produce a fresh array on every
// render and defeat the render-callback memoization below.
const NO_GROUPS: Group[] = []

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

  /**
   * Coordinator-managed reordering (epic #975, issue #979). The grid applies
   * every accepted drag locally and reports the new order to the
   * coordinator; it never calls persistence APIs directly and never
   * discards a drop. `displayOrder` is the coordinator's newest order for
   * this scope (survives unmount/remount); `claimGeneration` guards against
   * a stale grid instance overwriting a remounted one.
   */
  tileOrdering: {
    displayOrder: TileOrderItemRef[] | null
    reportOrder: (
      order: TileOrderItemRef[],
      generation?: number,
      dragContext?: ReorderDragContext,
    ) => void
    claimGeneration: () => number
  }

  /** Called when a tile drag starts or ends so the app can pause refreshes. */
  onDragActiveChange?: (active: boolean) => void
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
  tileOrdering,
  onDragActiveChange,
}: SortableTileGridProps) {
  const visibleImages = useMemo(
    () => (path.length === 0 ? [...uncategorizedImages, ...currentImages] : currentImages),
    [path.length, uncategorizedImages, currentImages],
  )

  const pathHiddenState = useMemo(() => getCategoryHiddenStateFromPath(path), [path])
  const inheritedProgramIds = useMemo(() => narrowProgramIds(path), [path])
  const inheritedGroupIds = useMemo(() => narrowGroupIds(path), [path])

  const parentId = path.length > 0 ? path[path.length - 1].id : null

  const builtItems = useMemo(
    () => buildTileItems(currentCategories, visibleImages),
    [currentCategories, visibleImages],
  )
  const orderedItems = useMemo(
    () =>
      tileOrdering.displayOrder !== null
        ? orderTileItems(builtItems, tileOrdering.displayOrder)
        : builtItems,
    [builtItems, tileOrdering.displayOrder],
  )

  const [items, setItems] = useState<TileItem[]>(() => orderedItems)
  const [activeItem, setActiveItem] = useState<TileItem | null>(null)
  const gridGenerationRef = useRef<number | null>(null)
  // Guards the unmount-cleanup signal so a normal drag-end does not fire
  // onDragActiveChange(false) twice (handleDragEnd already fires it).
  const dragEndedRef = useRef(false)
  // Keep the latest parent callback without re-running the unmount effect
  // whenever the prop identity changes mid-drag.
  const onDragActiveChangeRef = useRef(onDragActiveChange)
  useEffect(() => {
    onDragActiveChangeRef.current = onDragActiveChange
  })

  const claimGeneration = tileOrdering.claimGeneration
  // Claim a fresh grid-instance generation per scope so callbacks from an
  // unmounted grid (SPA navigation) cannot overwrite a remounted one.
  useLayoutEffect(() => {
    gridGenerationRef.current = claimGeneration()
  }, [claimGeneration, parentId])

  // If the grid unmounts during an active drag, reset the drag-active signal
  // so the parent does not keep background refresh and reorder refreshes
  // deferred indefinitely.  Only fire when handleDragEnd did not run.
  useEffect(() => {
    const wasActive = activeItem !== null
    return () => {
      if (wasActive && !dragEndedRef.current) {
        onDragActiveChangeRef.current?.(false)
      }
    }
  }, [activeItem])

  const syncedOrderedItemsRef = useRef(orderedItems)

  useLayoutEffect(() => {
    // Never rebuild the tile list while a drag is active. Rebuilding would
    // write new index props into useSortable and abort dnd-kit's optimistic
    // sorting reflow, which is the "tiles don't make room" freeze.
    if (activeItem !== null) return
    if (syncedOrderedItemsRef.current !== orderedItems) {
      syncedOrderedItemsRef.current = orderedItems
      setItems(orderedItems)
    }
  }, [activeItem, orderedItems])

  const allDescendantIds = useMemo(() => buildDescendantMap(allCategories), [allCategories])
  const blockedIdsMap = useMemo(() => {
    const map = new Map<number, Set<number>>()
    for (const cat of currentCategories) {
      const base = allDescendantIds.get(cat.id)
      const blocked = base ? new Set(base) : new Set<number>([cat.id])
      map.set(cat.id, blocked)
    }
    return map
  }, [allDescendantIds, currentCategories])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const sourceId = String(event.operation.source?.id)
      logDrag('SortableTileGrid.handleDragStart', {
        sourceId,
        itemFound: items.some((i) => tileId(i) === sourceId),
      })
      const item = items.find((i) => tileId(i) === sourceId)
      if (item) {
        dragEndedRef.current = false
        setActiveItem(item)
        onDragActiveChangeRef.current?.(true)
      } else {
        setActiveItem(null)
      }
    },
    [items],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { operation } = event
      logDrag('SortableTileGrid.handleDragEnd', {
        canceled: event.canceled,
        source: operation.source?.id,
        target: operation.target?.id,
      })
      try {
        if (operation.canceled) return

        const source = operation.source
        const target = operation.target
        if (!source || !target) {
          logDrag('SortableTileGrid.handleDragEnd no target', {})
          return
        }

        const sourceId = String(source.id)
        const targetId = String(target.id)

        if (targetId.startsWith(DROP_PREFIX)) {
          const targetCatId = Number(targetId.slice(DROP_PREFIX.length))
          logDrag('SortableTileGrid.handleDragEnd move-zone', { sourceId, targetId, targetCatId })
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
        const ids = items.map(tileId)
        const reorderedIds = move(ids, event)
        if (reorderedIds.length === ids.length && reorderedIds.every((id, i) => id === ids[i])) {
          logDrag('SortableTileGrid.handleDragEnd no reorder change', { sourceId, reorderedIds })
          return
        }
        const itemById = new Map(items.map((item) => [tileId(item), item] as const))
        const reordered = reorderedIds
          .map((id) => itemById.get(id))
          .filter((item): item is TileItem => item !== undefined)
        if (reordered.length !== items.length) return

        // Coordinator mode (issue #979): apply locally and report the new
        // order. Queueing, coalescing, persistence, and save-state UX are
        // owned above the grid; nothing is discarded here.
        setItems(reordered)
        const fromIndex = ids.indexOf(sourceId)
        const toIndex = reorderedIds.indexOf(sourceId)
        logDrag('SortableTileGrid.handleDragEnd reportOrder', {
          sourceId,
          fromIndex,
          toIndex,
          itemCount: reordered.length,
          generation: gridGenerationRef.current,
        })
        tileOrdering.reportOrder(
          reordered.map((item) => ({ type: item.type, id: item.data.id })),
          gridGenerationRef.current ?? undefined,
          // Drag detail rides along so lifecycle telemetry keeps per-drag
          // context (which tile moved, from/to index) on this surface.
          {
            itemType: sourceId.startsWith('img-') ? 'image' : 'category',
            itemId: Number(sourceId.slice(4)),
            fromIndex,
            toIndex,
          },
        )
      } finally {
        // Only emit the drag-end signal if we emitted a matching start signal.
        if (!dragEndedRef.current) {
          dragEndedRef.current = true
          setActiveItem(null)
          onDragActiveChangeRef.current?.(false)
        } else {
          setActiveItem(null)
        }
      }
    },
    [items, tileOrdering, onDropCategoryOnCategory, onDropImageOnCategory],
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
      <>
        <DndMonitor />
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
      </>
    </DragDropProvider>
  )
}
